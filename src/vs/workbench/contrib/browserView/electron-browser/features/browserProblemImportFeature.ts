/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { localizeNewTab } from '../../../shortestpath/browser/shortestPathNewTabInput.js';
import { IShortestPathModeService } from '../../../shortestpath/common/shortestPathMode.js';
import { BrowserEditorInput } from '../../common/browserEditorInput.js';
import { IBrowserViewModel } from '../../common/browserView.js';
import { BROWSER_EDITOR_ACTIVE, BrowserActionGroup, BrowserEditor, BrowserEditorContribution, BrowserWidgetLocation, IBrowserEditorWidget } from '../browserEditor.js';

const hintDismissedKey = 'shortestpath.browserImportHintDismissed';

const canImportContext = new RawContextKey<boolean>('shortestpath.browserCanImportProblem', false);
const importingContext = new RawContextKey<boolean>('shortestpath.browserImportingProblem', false);

export function canImportBrowserProblem(url: string | undefined): boolean {
	try {
		const parsed = new URL(url ?? '');
		return /^https?:$/.test(parsed.protocol) && !['shortestpath.cn', 'www.shortestpath.cn'].includes(parsed.hostname);
	} catch { return false; }
}

/** Native toolbar entry; the extension owns parser selection and file creation. */
export class BrowserProblemImportFeature extends BrowserEditorContribution {
	private readonly canImport: IContextKey<boolean>;
	private readonly importing: IContextKey<boolean>;
	private busy = false;
	private readonly hint = dom.$('.browser-problem-import-hint');
	private readonly arrow = dom.$('span.codicon.codicon-arrow-up');
	private model: IBrowserViewModel | undefined;
	private anchorRoot: HTMLElement | undefined;
	private generation = 0;
	private dismissedUrl: string | undefined;
	private visible = true;
	private matched = false;
	private readonly detect = this._register(new RunOnceScheduler(() => { void this.detectProblem(); }, 500));

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService private readonly commands: ICommandService,
		@INotificationService private readonly notifications: INotificationService,
		@IStorageService private readonly storage: IStorageService,
		@IShortestPathModeService modeService: IShortestPathModeService,
	) {
		super(editor);
		this.canImport = canImportContext.bindTo(contextKeyService);
		this.importing = importingContext.bindTo(contextKeyService);
		this.hint.hidden = true;
		this.arrow.setAttribute('aria-hidden', 'true');
		const message = dom.$('span');
		// allow-any-unicode-next-line
		message.textContent = localizeNewTab('You can import this problem using the Import Problem button above.', '这道题可以导入，点击上方“导入题目”按钮即可添加到工作区。');
		message.setAttribute('role', 'status');
		const dismiss = dom.$<HTMLButtonElement>('button');
		dismiss.type = 'button';
		// allow-any-unicode-next-line
		dismiss.textContent = localizeNewTab('Got It', '知道了');
		const never = dom.$<HTMLButtonElement>('button');
		never.type = 'button';
		// allow-any-unicode-next-line
		never.textContent = localizeNewTab('Don’t Show Again', '不再提示');
		this.hint.append(this.arrow, message, dismiss, never);
		this._register(dom.addDisposableListener(dismiss, 'click', () => this.dismissHint()));
		this._register(dom.addDisposableListener(never, 'click', () => {
			this.storage.store(hintDismissedKey, true, StorageScope.PROFILE, StorageTarget.USER);
			this.dismissHint();
		}));
		this._register(this.storage.onDidChangeValue(StorageScope.PROFILE, hintDismissedKey, this._store)(() => this.updateHint()));
		this._register(modeService.onDidChangeActiveBrowser(() => {
			this.generation++;
			this.updateHint();
			if (this.isSurfaceVisible()) { this.detect.schedule(); } else { this.detect.cancel(); }
		}));
	}

	override prerenderInput(input: BrowserEditorInput): void { this.canImport.set(canImportBrowserProblem(input.url)); }

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [{ location: BrowserWidgetLocation.Toolbar, element: this.hint, order: 1 }];
	}

	override onContainerCreated(container: HTMLElement): void {
		this.anchorRoot = container.closest<HTMLElement>('.browser-root') ?? undefined;
		const workbench = container.closest<HTMLElement>('.monaco-workbench');
		workbench?.append(this.hint);
		this.positionArrow();
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.model = model;
		this.canImport.set(canImportBrowserProblem(model.url));
		const schedule = () => {
			this.generation++;
			this.matched = false;
			this.canImport.set(canImportBrowserProblem(model.url));
			this.updateHint();
			this.detect.schedule();
		};
		store.add(model.onDidNavigate(schedule));
		store.add(model.onDidChangeLoadingState(schedule));
		store.add(model.onDidChangeTitle(() => this.detect.schedule()));
		schedule();
	}

	override onModelDetached(): void {
		this.generation++;
		this.detect.cancel();
		this.model = undefined;
		this.matched = false;
		this.canImport.reset();
		this.updateHint();
	}

	override onPaneVisibilityChanged(visible: boolean): void {
		this.visible = visible;
		this.generation++;
		this.updateHint();
		if (visible) { this.detect.schedule(); } else { this.detect.cancel(); }
	}

	private async detectProblem(): Promise<void> {
		const model = this.model, input = this.editor.input;
		if (!model || model.loading || !this.isSurfaceVisible() || this.busy || !(input instanceof BrowserEditorInput) || !canImportBrowserProblem(model.url) || this.storage.getBoolean(hintDismissedKey, StorageScope.PROFILE, false) || this.dismissedUrl === model.url) { return; }
		const generation = this.generation, url = model.url;
		try {
			const matched = await this.commands.executeCommand<boolean>('judger.canImportBrowserProblem', input.id, url);
			if (generation !== this.generation || model !== this.model || model.url !== url) { return; }
			this.matched = matched === true;
			this.updateHint();
		} catch { /* Detection is optional while the extension host starts. */ }
	}

	private dismissHint(): void {
		this.dismissedUrl = this.model?.url;
		this.updateHint();
	}

	private updateHint(): void {
		const hidden = !this.isSurfaceVisible() || !this.matched || this.busy || this.dismissedUrl === this.model?.url || this.storage.getBoolean(hintDismissedKey, StorageScope.PROFILE, false);
		if (this.hint.hidden !== hidden) {
			this.hint.hidden = hidden;
			this.hint.classList.toggle('visible', !hidden);
		}
		this.positionArrow();
	}

	private isSurfaceVisible(): boolean {
		return this.visible && !this.anchorRoot?.closest('[inert]');
	}

	override afterContainerLayout(): void { this.positionArrow(); }

	private positionArrow(): void {
		if (this.hint.hidden) { return; }
		// eslint-disable-next-line no-restricted-syntax
		const target = (this.anchorRoot ?? this.hint.parentElement)?.querySelector<HTMLElement>('.browser-actions-toolbar .codicon-cloud-download');
		const bounds = target?.getBoundingClientRect();
		this.arrow.hidden = !bounds?.width;
		if (bounds?.width) {
			const sourceWindow = dom.getWindow(target!);
			const width = this.hint.offsetWidth;
			const left = Math.max(8, Math.min(bounds.right - width, sourceWindow.innerWidth - width - 8));
			this.hint.style.left = `${left}px`;
			this.hint.style.top = `${bounds.bottom + 12}px`;
			this.arrow.style.left = `${Math.max(16, Math.min(bounds.left + bounds.width / 2 - left, width - 16))}px`;
		}
	}

	override dispose(): void {
		this.generation++;
		this.hint.remove();
		super.dispose();
	}

	async importProblem(): Promise<void> {
		const input = this.editor.input;
		if (this.busy || !(input instanceof BrowserEditorInput) || !canImportBrowserProblem(input.url)) { return; }
		this.dismissHint();
		this.busy = true;
		this.importing.set(true);
		try {
			const result = await this.commands.executeCommand<{ count: number; error?: string; cancelled?: boolean }>('judger.importBrowserProblem', input.id, undefined, input.url);
			if (result?.error) { this.notifications.error(result.error); }
		} catch (error) {
			this.notifications.error(error instanceof Error ? error : String(error));
		} finally {
			this.busy = false;
			this.importing.reset();
		}
	}
}

BrowserEditor.registerContribution(BrowserProblemImportFeature);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'shortestpath.browser.importProblem',
			// allow-any-unicode-next-line
			title: { value: localizeNewTab('Import Problem', '导入题目'), original: 'Import Problem' },
			icon: Codicon.cloudDownload,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, canImportContext, importingContext.negate()),
			menu: { id: MenuId.BrowserActionsToolbar, group: BrowserActionGroup.Tabs, order: 0, when: canImportContext },
		});
	}

	async run(accessor: ServicesAccessor, editor = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		if (editor instanceof BrowserEditor) { await editor.getContribution(BrowserProblemImportFeature)?.importProblem(); }
	}
});
