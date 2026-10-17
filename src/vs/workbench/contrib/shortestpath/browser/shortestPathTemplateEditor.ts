/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, Dimension } from '../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { language } from '../../../../base/common/platform.js';
import { hasKey } from '../../../../base/common/types.js';
import { URI } from '../../../../base/common/uri.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { CodeEditorWidget } from '../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { IEditorOptions } from '../../../../editor/common/config/editorOptions.js';
import { ILanguageService } from '../../../../editor/common/languages/language.js';
import { IModelService } from '../../../../editor/common/services/model.js';
import { ITextResourceConfigurationService } from '../../../../editor/common/services/textResourceConfiguration.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { emptyProgressRunner, IEditorProgressService } from '../../../../platform/progress/common/progress.js';
import { IOverlayWebview, IWebview, IWebviewService } from '../../webview/browser/webview.js';

const templateSetting = 'judger.language.cpp.Template';

interface TemplateEditorBounds {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
	readonly clipTop: number;
	readonly clipBottom: number;
}

function isTemplateEditorBounds(bounds: TemplateEditorBounds): boolean {
	return !!bounds && [bounds.left, bounds.top, bounds.width, bounds.height, bounds.clipTop, bounds.clipBottom]
		.every(value => typeof value === 'number' && Number.isFinite(value));
}

function isOverlayWebview(webview: IWebview | IOverlayWebview): webview is IOverlayWebview {
	return hasKey(webview, { container: true });
}

/** The webview reserves space; the workbench renders its real editor above that space. */
class TemplateEditor extends Disposable {
	private readonly viewport: HTMLElement;
	private readonly container: HTMLElement;
	private readonly model: ITextModel;
	private readonly editor: CodeEditorWidget;
	private readonly saveScheduler: RunOnceScheduler;
	private revision = 0;
	private savedRevision = 0;
	private syncing = false;
	private closed = false;
	private saveError: Error | undefined;
	private saves = Promise.resolve();

	constructor(
		private readonly webview: IOverlayWebview,
		private readonly defaultSource: string,
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@ILanguageService languageService: ILanguageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITextResourceConfigurationService textConfigurationService: ITextResourceConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this.viewport = append(webview.container, $('.shortestpath-template-editor'));
		Object.assign(this.viewport.style, { position: 'absolute', overflow: 'hidden', zIndex: '1', display: 'none' });
		this._register(toDisposable(() => this.viewport.remove()));
		this.container = append(this.viewport, $('div'));
		Object.assign(this.container.style, { position: 'absolute', width: '100%' });
		const resource = URI.from({ scheme: 'shortestpath-template', authority: generateUuid(), path: '/default.cpp' });
		this.model = this._register(modelService.createModel(this.readSource(), languageService.createById('cpp'), resource));
		const options = (): IEditorOptions => ({
			...textConfigurationService.getValue<IEditorOptions>(resource, 'editor'),
			// allow-any-unicode-next-line
			ariaLabel: language.startsWith('zh') ? '默认代码模板' : localize('defaultCodeTemplate', "Default Code Template"),
			// Keep the normal editor contributions, keybindings and themed rendering.
			automaticLayout: false,
		});
		const progressService: IEditorProgressService = {
			_serviceBrand: undefined,
			show: () => emptyProgressRunner,
			showWhile: async promise => { await promise; }
		};
		const editorInstantiationService = this._register(instantiationService.createChild(new ServiceCollection([IEditorProgressService, progressService])));
		this.editor = this._register(editorInstantiationService.createInstance(CodeEditorWidget, this.container, options(), {}));
		this.editor.setModel(this.model);
		this.saveScheduler = this._register(new RunOnceScheduler(() => this.save(), 250));
		this._register(this.model.onDidChangeContent(() => {
			if (!this.syncing) {
				this.revision++;
				this.saveScheduler.schedule();
			}
		}));
		this._register(textConfigurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(resource, 'editor')) {
				this.editor.updateOptions(options());
			}
		}));
		this._register(configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(templateSetting) && this.revision === this.savedRevision) {
				const source = this.readSource();
				if (source !== this.model.getValue()) {
					this.syncing = true;
					try {
						// Preserve undo history and selection when another settings surface changes the template.
						this.editor.executeEdits('configuration', [{ range: this.model.getFullModelRange(), text: source }]);
					} finally {
						this.syncing = false;
					}
				}
			}
		}));
	}

	private readSource(): string {
		const setting = this.configurationService.inspect<string>(templateSetting);
		return setting.userValue ?? setting.defaultValue ?? this.defaultSource;
	}

	private save(): void {
		const source = this.model.getValue();
		const revision = this.revision;
		this.saves = this.saves.then(async () => {
			if (source.length > 100_000) {
				// allow-any-unicode-next-line
				throw new Error(language.startsWith('zh') ? '代码模板不能超过 100,000 个字符。' : localize('templateTooLong', "The code template cannot exceed 100,000 characters."));
			}
			await this.configurationService.updateValue(templateSetting, source, ConfigurationTarget.USER);
			this.savedRevision = revision;
			this.saveError = undefined;
			if (!this.closed && this.revision === revision) {
				void this.webview.postMessage({ type: 'templateSaveStatus', saved: true });
			}
		}).catch(error => {
			this.saveError = error instanceof Error ? error : new Error(String(error));
			this.notificationService.error(this.saveError);
		});
	}

	async flush(): Promise<string> {
		do {
			if (this.saveScheduler.isScheduled() || this.saveError) {
				this.saveScheduler.cancel();
				this.save();
			}
			await this.saves;
		} while (this.saveScheduler.isScheduled());
		if (this.saveError) {
			throw this.saveError;
		}
		return this.model.getValue();
	}

	layout(bounds: TemplateEditorBounds): void {
		const top = Math.max(bounds.top, bounds.clipTop, 0);
		const bottom = Math.min(bounds.top + bounds.height, bounds.clipBottom);
		this.viewport.style.display = bounds.width > 0 && bounds.height > 0 && bottom > top ? 'block' : 'none';
		Object.assign(this.viewport.style, { left: `${bounds.left}px`, top: `${top}px`, width: `${Math.max(0, bounds.width)}px`, height: `${Math.max(0, bottom - top)}px` });
		this.container.style.top = `${bounds.top - top}px`;
		this.editor.layout(new Dimension(Math.max(0, bounds.width), Math.max(0, bounds.height)));
	}

	override dispose(): void {
		this.closed = true;
		// Capture pending text before disposing the model, even when settings closes immediately after typing.
		if (this.saveScheduler.isScheduled()) {
			this.saveScheduler.cancel();
			this.save();
		}
		super.dispose();
	}
}

const editors = new Map<IOverlayWebview, TemplateEditor>();
const snippetEditors = new Map<IOverlayWebview, SnippetEditor>();

/** Render the selected C++ snippet in a native editor and return its last draft on switch. */
class SnippetEditor extends Disposable {
	private readonly viewport: HTMLElement;
	private readonly container: HTMLElement;
	private readonly model: ITextModel;
	private readonly editor: CodeEditorWidget;
	private readonly draftScheduler: RunOnceScheduler;
	private syncing = false;
	private closed = false;
	private contentRevision = 0;

	constructor(
		private readonly webview: IOverlayWebview,
		source: string,
		private selectionRevision: number,
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
		@ILanguageService languageService: ILanguageService,
		@ITextResourceConfigurationService textConfigurationService: ITextResourceConfigurationService,
	) {
		super();
		this.viewport = append(webview.container, $('.shortestpath-snippet-editor'));
		Object.assign(this.viewport.style, { position: 'absolute', overflow: 'hidden', zIndex: '1', display: 'none' });
		this._register(toDisposable(() => this.viewport.remove()));
		this.container = append(this.viewport, $('div'));
		Object.assign(this.container.style, { position: 'absolute', width: '100%' });
		const resource = URI.from({ scheme: 'shortestpath-snippet', authority: generateUuid(), path: '/snippet.cpp' });
		this.model = this._register(modelService.createModel(source, languageService.createById('cpp'), resource));
		const options = (): IEditorOptions => ({
			...textConfigurationService.getValue<IEditorOptions>(resource, 'editor'),
			// allow-any-unicode-next-line
			ariaLabel: language.startsWith('zh') ? '代码片段内容' : localize('snippetBody', "Snippet Body"),
			automaticLayout: false,
		});
		const progressService: IEditorProgressService = {
			_serviceBrand: undefined,
			show: () => emptyProgressRunner,
			showWhile: async promise => { await promise; }
		};
		const editorInstantiationService = this._register(instantiationService.createChild(new ServiceCollection([IEditorProgressService, progressService])));
		this.editor = this._register(editorInstantiationService.createInstance(CodeEditorWidget, this.container, options(), {}));
		this.editor.setModel(this.model);
		this.draftScheduler = this._register(new RunOnceScheduler(() => this.sendDraft(), 80));
		this._register(this.model.onDidChangeContent(() => {
			if (!this.syncing && !this.closed) {
				this.contentRevision++;
				this.draftScheduler.schedule();
			}
		}));
		this._register(textConfigurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration(resource, 'editor')) {
				this.editor.updateOptions(options());
			}
		}));
	}

	private sendDraft(): void {
		if (!this.closed) {
			void this.webview.postMessage({ type: 'snippetBodyChanged', selectionRevision: this.selectionRevision, contentRevision: this.contentRevision, source: this.model.getValue() });
		}
	}

	layout(bounds: TemplateEditorBounds, selectionRevision: number, source?: string): { selectionRevision: number; contentRevision: number; source: string } | undefined {
		let previous: { selectionRevision: number; contentRevision: number; source: string } | undefined;
		if (selectionRevision !== this.selectionRevision) {
			this.draftScheduler.cancel();
			previous = { selectionRevision: this.selectionRevision, contentRevision: this.contentRevision, source: this.model.getValue() };
			this.selectionRevision = selectionRevision;
			if (typeof source === 'string' && source !== this.model.getValue()) {
				this.syncing = true;
				try {
					this.model.setValue(source);
				} finally {
					this.syncing = false;
				}
			}
		}
		const top = Math.max(bounds.top, bounds.clipTop, 0);
		const bottom = Math.min(bounds.top + bounds.height, bounds.clipBottom);
		this.viewport.style.display = bounds.width > 0 && bounds.height > 0 && bottom > top ? 'block' : 'none';
		Object.assign(this.viewport.style, { left: `${bounds.left}px`, top: `${top}px`, width: `${Math.max(0, bounds.width)}px`, height: `${Math.max(0, bottom - top)}px` });
		this.container.style.top = `${bounds.top - top}px`;
		this.editor.layout(new Dimension(Math.max(0, bounds.width), Math.max(0, bottom - top)));
		return previous;
	}

	override dispose(): void {
		this.closed = true;
		super.dispose();
	}
}

CommandsRegistry.registerCommand('_shortestpath.layoutTemplateEditor', (accessor, bounds: TemplateEditorBounds, defaultSource: string, viewType: string = 'shortestpath.settings') => {
	if (!isTemplateEditorBounds(bounds) || typeof defaultSource !== 'string' || defaultSource.length > 100_000 || !isTemplateEditorViewType(viewType)) {
		return;
	}
	for (const candidate of accessor.get(IWebviewService).webviews) {
		if (candidate.providedViewType !== viewType || candidate.extension?.id.value !== 'shortestpath.shortestpath-setup' || !isOverlayWebview(candidate)) {
			continue;
		}
		const webview = candidate;
		let editor = editors.get(webview);
		if (!editor && bounds.width > 0 && bounds.height > 0) {
			editor = accessor.get(IInstantiationService).createInstance(TemplateEditor, webview, defaultSource);
			editors.set(webview, editor);
			const lifetime = new DisposableStore();
			lifetime.add(editor);
			lifetime.add(webview.onDidDispose(() => {
				editors.delete(webview);
				lifetime.dispose();
			}));
		}
		editor?.layout(bounds);
		break;
	}
});

CommandsRegistry.registerCommand('_shortestpath.layoutSnippetEditor', (accessor, bounds: TemplateEditorBounds, selectionRevision: number, source?: string) => {
	if (!isTemplateEditorBounds(bounds) || !Number.isInteger(selectionRevision) || selectionRevision < 0 || (source !== undefined && typeof source !== 'string')) {
		return;
	}
	for (const candidate of accessor.get(IWebviewService).webviews) {
		if (candidate.providedViewType !== 'shortestpath.cppSnippets' || candidate.extension?.id.value !== 'shortestpath.shortestpath-setup' || !isOverlayWebview(candidate)) {
			continue;
		}
		const webview = candidate;
		let editor = snippetEditors.get(webview);
		if (!editor && bounds.width > 0 && bounds.height > 0) {
			editor = accessor.get(IInstantiationService).createInstance(SnippetEditor, webview, source ?? '', selectionRevision);
			snippetEditors.set(webview, editor);
			const lifetime = new DisposableStore();
			lifetime.add(editor);
			lifetime.add(webview.onDidDispose(() => {
				snippetEditors.delete(webview);
				lifetime.dispose();
			}));
		}
		return editor?.layout(bounds, selectionRevision, source);
	}
	return;
});

function isTemplateEditorViewType(viewType: string): boolean {
	return viewType === 'shortestpath.settings' || viewType === 'shortestpath.gettingStarted';
}

CommandsRegistry.registerCommand('_shortestpath.flushTemplateEditor', async (_accessor, viewType: string) => {
	if (isTemplateEditorViewType(viewType)) {
		for (const [webview, editor] of editors) {
			if (webview.providedViewType === viewType) {
				return editor.flush();
			}
		}
	}
	return undefined;
});
