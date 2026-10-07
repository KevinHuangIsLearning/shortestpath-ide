/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextEditorService } from '../../../../services/textfile/common/textEditorService.js';
import { BrowserNewTabPlacementSettingId, BrowserViewWorkbenchService } from '../../../browserView/electron-browser/browserViewWorkbenchService.js';
import { BrowserSourceEditorInput } from '../../../browserView/common/browserSourceEditorInput.js';
import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IEditorOptions, IResourceEditorInputIdentifier } from '../../../../../platform/editor/common/editor.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IQuickInputService, IQuickPick, IQuickPickItem, IQuickPickSeparator, IQuickPickItemButtonEvent, IQuickPickDidAcceptEvent, IQuickInputHideEvent, QuickInputHideReason } from '../../../../../platform/quickinput/common/quickInput.js';
import { IEditorGroup, IEditorReplacement, IEditorGroupsService, IEditorPart, IEmbeddedEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { canOpenEditorsInNewWindow, EditorInputCapabilities, IUntypedEditorInput, EditorsOrder } from '../../../../common/editor.js';
import { ACTIVE_GROUP, AUX_WINDOW_GROUP, IEditorService, PreferredGroup, SIDE_GROUP } from '../../../../services/editor/common/editorService.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { workbenchInstantiationService, TestFileEditorInput, TestEditorGroupView } from '../../../../test/browser/workbenchTestServices.js';
import { BrowserEditorInput, IBrowserEditorInputData } from '../../../browserView/common/browserEditorInput.js';
import { IBrowserViewModel, IBrowserViewOpenHandler, IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { IWebviewWorkbenchService } from '../../../webviewPanel/browser/webviewWorkbenchService.js';
import { ShortestPathModeService } from '../../electron-browser/shortestPathMode.contribution.js';
import { OpenIntegratedBrowserAction, QuickOpenBrowserAction } from '../../../browserView/electron-browser/features/browserTabManagementFeatures.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { canImportBrowserProblem, BrowserProblemImportFeature } from '../../../browserView/electron-browser/features/browserProblemImportFeature.js';
import { BrowserEditor } from '../../../browserView/electron-browser/browserEditor.js';
import { BrowserWelcomeFeature } from '../../../browserView/electron-browser/features/browserWelcomeFeature.js';
import { IShortestPathModeService, ShortestPathMode, shortestPathHome } from '../../common/shortestPathMode.js';

/** Exercise production routing without constructing the navigation presentation. */
class TestModeService extends ShortestPathModeService {
	protected override async create(): Promise<void> { this.createBrowserPart(document.createElement('div')); }
	protected override applyMode(mode: ShortestPathMode): void { this.mode = mode; }
	protected override renderTabs(): void { }
	protected override refresh(): void { }
	ensureBlankTab(): Promise<void> { return this.ensureBrowserTab(); }
	synchronizeTabs(): void { super.renderTabs(); }
}

suite('ShortestPath browser routing', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup(createGate?: Promise<void>, createStarted?: () => void) {
		const instantiation = workbenchInstantiationService(undefined, store);
		const opened: { input: EditorInput; options: IEditorOptions | undefined; group: PreferredGroup | undefined }[] = [];
		const untypedOpened: { input: IUntypedEditorInput; group: PreferredGroup | undefined }[] = [];
		const known = new Map<string, BrowserEditorInput>();
		const navigations: string[] = [];
		const browserInputs: EditorInput[] = [];
		const browserGroup = new class extends TestEditorGroupView {
			override editors = browserInputs;
			override count = 0;
			override contains(input: EditorInput) { return browserInputs.includes(input); }
			override focus() { }
		}(99);
		const browserPart = new class extends mock<IEmbeddedEditorPart>() {
			override groups = [browserGroup];
			override activeGroup = browserGroup;
			override readonly onDidAddGroup = Event.None;
			override readonly onDidRemoveGroup = Event.None;
			override readonly onDidChangeActiveGroup = Event.None;
			override getGroups() { return this.groups; }
			override enforcePartOptions() { return Disposable.None; }
			override setVisible() { }
			override dispose() { }
		};
		instantiation.stub(IEditorGroupsService, 'createEmbeddedEditorPart', () => browserPart);
		let preferredCalls = 0;
		let handler: IBrowserViewOpenHandler | undefined;
		const editors = new class extends mock<IEditorService>() {
			override getEditors(_order: EditorsOrder) { return opened.map(({ input }) => ({ editor: input, groupId: 7 })); }
			override isOpened(input: IResourceEditorInputIdentifier) { return opened.some(entry => entry.input === input); }
			override async openEditor(input: EditorInput | IUntypedEditorInput, optionsOrGroup?: IEditorOptions | PreferredGroup, group?: PreferredGroup) {
				if (input instanceof EditorInput) {
					const options = typeof optionsOrGroup === 'object' && !('id' in optionsOrGroup) ? optionsOrGroup : undefined;
					if (group === browserGroup) {
						if (!browserInputs.includes(input)) { browserInputs.push(input); browserGroup.count = browserInputs.length; }
						if (!options?.inactive || !browserGroup.activeEditor) { browserGroup.activeEditor = input; }
					} else { opened.push({ input, options, group }); }
				} else {
					untypedOpened.push({ input, group: optionsOrGroup as PreferredGroup | undefined });
				}
				return undefined;
			}
		};
		const browsers = new class extends mock<IBrowserViewWorkbenchService>() {
			override readonly onDidChangeBrowserViews = Event.None;
			override getContextualBrowserViews() { return known; }
			override registerOpenHandler(value: IBrowserViewOpenHandler) { handler = value; return Disposable.None; }
			override async getPreferredGroup(group?: PreferredGroup) { preferredCalls++; return group ?? SIDE_GROUP; }
			override async createBrowserView() {
				if (createGate) { createStarted?.(); await createGate; }
				const model = new class extends mock<IBrowserViewModel>() {
					override url = '';
					override readonly onWillDispose = Event.None;
					override readonly onDidClose = Event.None;
					override readonly onDidChangeTitle = Event.None;
					override readonly onDidChangeFavicon = Event.None;
					override readonly onDidChangeLoadingState = Event.None;
					override readonly onDidNavigate = Event.None;
					override readonly onDidKeyCommand = Event.None;
					override async loadURL(url: string) { navigations.push(url); this.url = url; }
					override async focus() { }
					override dispose() { }
				};
				const input = store.add(instantiation.createInstance(BrowserEditorInput, { id: String(known.size) }, async () => model));
				input.model = model;
				known.set(input.id, input);
				return input;
			}
		};
		instantiation.stub(IEditorService, editors);
		instantiation.stub(IBrowserViewWorkbenchService, browsers);
		instantiation.stub(IMainProcessService, new class extends mock<IMainProcessService>() {
			override getChannel() { return new class extends mock<IChannel>() { }; }
		});
		instantiation.stub(IWebviewWorkbenchService, new class extends mock<IWebviewWorkbenchService>() {
			override registerOpenHandler() { return Disposable.None; }
		});
		instantiation.stub(ILifecycleService, new class extends mock<ILifecycleService>() {
			override async when() { }
		});
		instantiation.stub(IConfigurationService, new TestConfigurationService({ 'shortestpath.setup.completed': true }));
		const service = store.add(instantiation.createInstance(TestModeService));
		instantiation.stub(IShortestPathModeService, service);
		return { service, opened, untypedOpened, navigations, browserInputs, browserGroup, instantiation, known, handler: () => handler!, preferredCalls: () => preferredCalls };
	}

	for (const managed of [true, false]) {
		test(`titlebar picker returns a ${managed ? 'browsing' : 'editor'} tab to its owning surface`, async () => {
			const { service, opened, instantiation } = setup();
			service.mode = managed ? 'browse' : 'solve';
			const input = await service.openBrowser('https://example.com/A');
			service.mode = 'solve';
			const before = opened.length;
			type TabItem = IQuickPickItem & { editor: BrowserEditorInput; groupId: number };
			let accept: (event: IQuickPickDidAcceptEvent) => void = () => { };
			const hidden = store.add(new Emitter<IQuickInputHideEvent>());
			const picker = new class extends mock<IQuickPick<TabItem, { useSeparators: true }>>() {
				override items: readonly (TabItem | IQuickPickSeparator)[] = [];
				override selectedItems: readonly TabItem[] = [];
				override activeItems: readonly TabItem[] = [];
				override readonly onDidTriggerItemButton = Event.None;
				override readonly onDidTriggerButton = Event.None;
				override readonly onDidAccept: Event<IQuickPickDidAcceptEvent> = listener => { accept = listener; return Disposable.None; };
				override readonly onDidHide = hidden.event;
				override show() { }
				override hide() { hidden.fire({ reason: QuickInputHideReason.Other }); }
				override dispose() { }
			};
			instantiation.stub(IQuickInputService, 'createQuickPick', () => picker);
			instantiation.stub(IEditorGroupsService, new class extends mock<IEditorGroupsService>() {
				override getGroups() { return []; }
			});
			instantiation.invokeFunction(accessor => new QuickOpenBrowserAction().run(accessor));
			picker.selectedItems = [picker.items.find((item): item is TabItem => item.type !== 'separator' && item.editor === input)!];
			await accept({ inBackground: false });
			picker.hide();
			assert.deepStrictEqual({ mode: service.mode, active: service.activeBrowser === input, additionalEditorOpens: opened.length - before, owned: service.ownsBrowserTab(input) }, {
				mode: managed ? 'browse' : 'solve', active: managed, additionalEditorOpens: managed ? 0 : 1, owned: managed,
			});
		});
	}

	test('import toolbar visibility follows URL and hides on ShortestPath OJ and blank tabs', async () => {
		const { service, instantiation } = setup();
		service.mode = 'browse';
		const input = await service.openBrowser('https://example.com/problem');
		const editor = new class extends mock<BrowserEditor>() {
			override readonly onDidChangeModel = Event.None;
			override get input() { return input; }
		};
		const feature = store.add(instantiation.createInstance(BrowserProblemImportFeature, editor));
		const visibility: boolean[] = [];
		for (const url of ['https://example.com/problem', 'https://shortestpath.cn/topics', 'https://www.shortestpath.cn/problem/A', '', 'file:///tmp/A.html', 'https://spoj.com/problems/TEST']) {
			await input.model!.loadURL(url);
			feature.prerenderInput(input);
			visibility.push(instantiation.get(IContextKeyService).getContextKeyValue<boolean>('shortestpath.browserCanImportProblem') ?? false);
		}
		feature.onModelDetached();
		assert.deepStrictEqual({ visibility, invalid: canImportBrowserProblem('http:'), detached: instantiation.get(IContextKeyService).getContextKeyValue('shortestpath.browserCanImportProblem') }, { visibility: [true, false, false, false, false, true], invalid: false, detached: false });
	});

	test('import toolbar passes its own tab and URL and suppresses duplicate clicks', async () => {
		const { service, instantiation } = setup();
		service.mode = 'browse';
		const input = await service.openBrowser('https://example.com/problem');
		const editor = new class extends mock<BrowserEditor>() {
			override readonly onDidChangeModel = Event.None;
			override get input() { return input; }
		};
		const done = new DeferredPromise<{ count: number; error?: string }>();
		const calls: unknown[][] = [];
		const errors: string[] = [];
		instantiation.stub(ICommandService, new class extends mock<ICommandService>() {
			override async executeCommand<T>(id: string, ...args: unknown[]): Promise<T> { calls.push([id, ...args]); return await done.p as T; }
		});
		instantiation.stub(INotificationService, new class extends mock<INotificationService>() {
			override error(error: string | string[] | Error): void { errors.push(String(error)); }
		});
		const feature = store.add(instantiation.createInstance(BrowserProblemImportFeature, editor));
		const first = feature.importProblem();
		await feature.importProblem();
		await done.complete({ count: 0, error: 'failed import' });
		await first;
		assert.deepStrictEqual({ calls, errors, busy: instantiation.get(IContextKeyService).getContextKeyValue('shortestpath.browserImportingProblem') }, { calls: [['judger.importBrowserProblem', input.id, undefined, input.url]], errors: ['failed import'], busy: false });
	});

	test('managed blank tabs show the custom start page and loaded tabs hide it', async () => {
		const { service, instantiation } = setup();
		service.mode = 'browse';
		const input = await service.openBrowser('', true);
		const editor = new class extends mock<BrowserEditor>() {
			override readonly onDidChangeModel = Event.None;
			override get input() { return input; }
		};
		const feature = store.add(instantiation.createInstance(BrowserWelcomeFeature, editor));
		feature.prerenderInput(input);
		const custom = feature.widgets[1].element;
		const blank = { custom: custom.style.display, native: feature.widgets[0].element.style.display };
		custom.querySelector<HTMLButtonElement>('.shortestpath-browser-new-tab-shortcut')!.click();
		feature.prerenderInput(input);
		assert.deepStrictEqual({ blank, loaded: custom.style.display, url: input.url }, {
			blank: { custom: '', native: 'none' }, loaded: 'none', url: shortestPathHome,
		});
	});

	test('entering browsing opens the OJ in its only blank tab on every entry', async () => {
		const { service, navigations, browserInputs, browserGroup } = setup();
		await service.switchMode('browse');
		assert.deepStrictEqual(navigations, [shortestPathHome]);
		assert.strictEqual(browserInputs.length, 1);
		const old = browserInputs[0];
		browserInputs.length = 0;
		browserGroup.count = 0;
		old.dispose();
		await service.ensureBlankTab();
		assert.strictEqual(navigations.length, 1);
		service.mode = 'solve';
		await service.switchMode('browse');
		assert.strictEqual(navigations[navigations.length - 1], shortestPathHome);
		assert.strictEqual(browserInputs.length, 1);
	});

	for (const urls of [['https://example.com/A'], ['', '']]) {
		test(`entering browsing preserves existing tabs: ${JSON.stringify(urls)}`, async () => {
			const { service, navigations, browserInputs } = setup();
			service.mode = 'browse';
			for (const url of urls) { await service.openBrowser(url, true); }
			const before = [...navigations];
			service.mode = 'solve';
			await service.switchMode('browse');
			assert.deepStrictEqual(navigations, before);
			assert.strictEqual(browserInputs.length, urls.length);
		});
	}

	test('closing all browsing tabs replaces them with exactly one blank tab', async () => {
		const { service, browserInputs, browserGroup, known, navigations } = setup();
		service.mode = 'browse';
		const old = await service.openBrowser('https://example.com/A');
		browserInputs.length = 0;
		browserGroup.count = 0;
		old.dispose(true);
		service.synchronizeTabs();
		service.synchronizeTabs();
		await service.ensureBlankTab();
		assert.deepStrictEqual({ count: browserInputs.length, views: known.size, urls: browserInputs.map(input => (input as BrowserEditorInput).url ?? ''), navigations }, { count: 1, views: 2, urls: [''], navigations: ['https://example.com/A'] });
	});

	test('switching out of browse before automatic creation leaves solving tabs alone', async () => {
		const { service, known } = setup();
		service.mode = 'browse';
		const pending = service.ensureBlankTab();
		service.mode = 'solve';
		await pending;
		assert.strictEqual(known.size, 0);
	});

	test('switching modes during automatic view creation disposes the unused view', async () => {
		const gate = new DeferredPromise<void>();
		const started = new DeferredPromise<void>();
		const { service, known, opened, browserInputs } = setup(gate.p, () => { void started.complete(); });
		service.mode = 'browse';
		const pending = service.ensureBlankTab();
		await started.p;
		service.mode = 'solve';
		await gate.complete();
		await pending;
		assert.deepStrictEqual({ mode: service.mode, solveTabs: opened.length, browseTabs: browserInputs.length, disposed: [...known.values()].every(input => input.isDisposed()) }, { mode: 'solve', solveTabs: 0, browseTabs: 0, disposed: true });
	});

	for (const mode of ['browse', 'solve'] as const) {
		test(`new blank tabs in ${mode} mode do not navigate to an empty URL`, async () => {
			const { service, navigations, known } = setup();
			service.mode = mode;
			await service.openBrowser('', true);
			await service.openBrowser('  ', true);
			assert.deepStrictEqual({ views: known.size, navigations }, { views: 2, navigations: [] });
		});
	}

	test('solving opens respect explicit group and background options', async () => {
		const { service, opened, handler } = setup();
		const input = await service.openBrowser('https://example.com/A', true, true, { group: 7, inactive: true });
		assert.deepStrictEqual({ url: input.url, count: opened.length, options: opened[0].options, group: opened[0].group, nativeEditor: handler().shouldOpenEditor(input, { type: 'user' }, {}) }, {
			url: 'https://example.com/A', count: 1, options: { pinned: true, inactive: true, preserveFocus: true }, group: 7, nativeEditor: true,
		});
	});

	test('showing and reusing existing problem pages keeps their original editor group', async () => {
		const { service, opened, known, preferredCalls } = setup();
		const input = await service.openBrowser('https://example.com/A');
		service.mode = 'browse';
		await service.showBrowser(input);
		service.mode = 'solve';
		const reused = await service.openBrowser('https://example.com/A');
		assert.deepStrictEqual({ same: reused === input, views: known.size, placements: opened.map(entry => entry.group), preferredCalls: preferredCalls() }, {
			same: true, views: 1, placements: [SIDE_GROUP, undefined, undefined], preferredCalls: 1,
		});
	});

	test('background browsing tabs stay in the independent browser space', async () => {
		const { service, opened, known } = setup();
		service.mode = 'browse';
		const input = await service.openBrowser('https://example.com/A', true, true);
		service.mode = 'solve';
		await service.showBrowser(input, true);
		assert.deepStrictEqual({ editors: opened.length, views: known.size, mode: service.mode }, { editors: 0, views: 1, mode: 'solve' });
	});
	test('problem-display URL reuse excludes browsing tabs', async () => {
		const { service, opened, untypedOpened, instantiation } = setup();
		service.mode = 'browse';
		const input = await service.openBrowser('https://example.com/A');
		instantiation.stub(IEditorService, 'isOpened', () => true);
		service.mode = 'solve';
		await instantiation.invokeFunction(accessor => new OpenIntegratedBrowserAction().run(accessor, { url: input.url, openInEditor: true, reuseUrlFilter: 'https://example.com/*' }));
		assert.deepStrictEqual({ solvingReuse: opened.length, newEditor: untypedOpened.length, owned: service.ownsBrowserTab(input) }, { solvingReuse: 0, newEditor: 1, owned: true });
	});

	test('explicit side and problem-display commands use editor groups even from browsing mode', async () => {
		const { service, untypedOpened, instantiation } = setup();
		service.mode = 'browse';
		const action = new OpenIntegratedBrowserAction();
		await instantiation.invokeFunction(accessor => action.run(accessor, { url: 'https://example.com/A', openToSide: true }));
		await instantiation.invokeFunction(accessor => action.run(accessor, { url: 'https://example.com/B', openInEditor: true }));
		assert.deepStrictEqual(untypedOpened.map(({ input, group }) => ({ scheme: 'resource' in input ? input.resource?.scheme : undefined, options: input.options, group })), [
			{ scheme: 'vscode-browser', options: { viewState: { url: 'https://example.com/A' } }, group: SIDE_GROUP },
			{ scheme: 'vscode-browser', options: { viewState: { url: 'https://example.com/B' } }, group: SIDE_GROUP },
		]);
	});


	test('problem browser replaces the dirty source tab and reuses it without changing group layout', async () => {
		const { service, opened, instantiation, preferredCalls } = setup();
		service.mode = 'browse';
		const browser = await service.openBrowser('https://example.com/A');
		const source = store.add(new TestFileEditorInput(URI.file('/A.cpp'), 'test.source'));
		source.setDirty();
		const inputs: EditorInput[] = [source];
		let replacements = 0;
		const group = new class extends TestEditorGroupView {
			override editors = inputs;
			override async replaceEditors(entries: IEditorReplacement[]) {
				assert.strictEqual(entries[0].editor, source);
				assert.strictEqual(entries[0].forceReplaceDirty, true);
				inputs.splice(0, 1, store.add(entries[0].replacement as EditorInput));
				replacements++;
			}
		}(7);
		const mainPart = new class extends mock<IEditorPart>() { override activeGroup = group; };
		instantiation.stub(IEditorGroupsService, new class extends mock<IEditorGroupsService>() {
			override groups = [group];
			override mainPart = mainPart;
			override getGroup() { return group; }
		});
		instantiation.stub(ITextEditorService, 'createTextEditor', () => source);
		instantiation.stub(IEditorService, 'findEditors', () => [{ editor: source, groupId: 7 }]);
		instantiation.stub(IBrowserViewWorkbenchService, 'getOrCreateLazy', () => browser);
		const action = new OpenIntegratedBrowserAction();
		await instantiation.invokeFunction(accessor => action.run(accessor, { url: 'https://example.com/A', sourceEditor: source.resource.toString(), sourceEditorRatio: 65 }));
		await instantiation.invokeFunction(accessor => action.run(accessor, { sourceEditor: source.resource.toString() }));
		const input = inputs[0] as BrowserSourceEditorInput;
		assert.deepStrictEqual({
			paired: input instanceof BrowserSourceEditorInput, source: input.primary === source,
			browser: input.secondary === browser, dirty: input.isDirty(), ratio: input.initialSplitRatio,
			replacements, placementCalls: preferredCalls(), opened: opened.map(entry => entry.input === input),
		}, { paired: true, source: true, browser: true, dirty: true, ratio: 0.65, replacements: 1, placementCalls: 2, opened: [true, true] });
	});


	test('importing a dirty source in an auxiliary window moves the native source before pairing in main', async () => {
		const { instantiation, opened } = setup();
		const source = store.add(new TestFileEditorInput(URI.file('/aux.cpp'), 'test.source'));
		source.setDirty();
		const mainInputs: EditorInput[] = [];
		const mainGroup = new class extends TestEditorGroupView {
			override editors = mainInputs;
			override async replaceEditors(entries: IEditorReplacement[]) {
				assert.strictEqual(entries[0].editor, source);
				mainInputs.splice(0, 1, store.add(entries[0].replacement as EditorInput));
			}
		}(1);
		let moved = false;
		const auxiliaryGroup = new class extends TestEditorGroupView {
			override editors = [source];
			override moveEditor(input: EditorInput, target: IEditorGroup) {
				assert.deepStrictEqual([input === source, target === mainGroup], [true, true]);
				mainInputs.push(input);
				moved = true;
				return true;
			}
		}(2);
		instantiation.stub(IEditorGroupsService, new class extends mock<IEditorGroupsService>() {
			override groups = [mainGroup, auxiliaryGroup];
			override mainPart = new class extends mock<IEditorPart>() { override activeGroup = mainGroup; };
			override getGroup() { return auxiliaryGroup; }
		});
		instantiation.stub(ITextEditorService, 'createTextEditor', () => source);
		instantiation.stub(IEditorService, 'findEditors', () => [{ editor: source, groupId: 2 }]);
		instantiation.stub(IBrowserViewWorkbenchService, 'getPreferredGroup', async () => mainGroup);
		instantiation.stub(IBrowserViewWorkbenchService, 'getOrCreateLazy', (data: IBrowserEditorInputData) => store.add(instantiation.createInstance(BrowserEditorInput, data, async () => { throw new Error('No model needed'); })));
		await instantiation.invokeFunction(accessor => new OpenIntegratedBrowserAction().run(accessor, { sourceEditor: source.resource.toString(), url: 'https://example.com/problem' }));
		const pair = mainInputs[0] as BrowserSourceEditorInput;
		assert.deepStrictEqual({ moved, source: pair.primary === source, dirty: pair.isDirty(), target: opened.at(-1)?.group === mainGroup,
			pinned: (pair.secondary as BrowserEditorInput).associatedResource?.toString() },
			{ moved: true, source: true, dirty: true, target: true, pinned: 'https://example.com/problem' });
	});

	test('links and popups from a problem pair switch to browsing and leave the source pair intact', async () => {
		const { service, instantiation, opened, handler } = setup();
		service.mode = 'solve';
		const parent = await service.openBrowser('https://example.com/problem');
		const source = store.add(new TestFileEditorInput(URI.file('/A.cpp'), 'test.source'));
		source.setDirty();
		const pair = store.add(instantiation.createInstance(BrowserSourceEditorInput, parent, source, 50));
		opened.splice(0, opened.length, { input: pair, options: undefined, group: undefined });
		const child = store.add(instantiation.createInstance(BrowserEditorInput, { id: 'editorial', url: 'https://example.com/editorial' }, async () => { throw new Error('No model needed'); }));
		// Reuse the resolved mock model from the parent to exercise the native browser-part path.
		child.model = parent.model!;
		const handled = handler().shouldOpenEditor(child, { type: 'user' }, { parentViewId: parent.id, auxiliaryWindow: { x: 0, y: 0, width: 600, height: 400 } });
		await new Promise<void>(resolve => setTimeout(resolve, 0));
		assert.deepStrictEqual({ handled, mode: service.mode, owns: service.ownsBrowserTab(child), active: service.activeBrowser === child,
			sourcePair: opened.some(entry => entry.input === pair), dirty: pair.isDirty() },
			{ handled: false, mode: 'browse', owns: true, active: true, sourcePair: true, dirty: true });
	});

	test('native browser pane rejects auxiliary windows before resolving or attaching a view', async () => {
		const { instantiation } = setup();
		const browser = store.add(instantiation.createInstance(BrowserEditorInput, { id: 'aux-reject' }, async () => { throw new Error('Must not resolve'); }));
		const pane = Object.assign(Object.create(BrowserEditor.prototype), { group: { windowId: -999 } }) as BrowserEditor;
		await assert.rejects(pane.setInput(browser, undefined, { newInGroup: true }, CancellationToken.None), /主窗口/);
	});

	test('browser tabs and source pairs cannot be moved or copied into another window', () => {
		const { instantiation } = setup();
		const browser = store.add(instantiation.createInstance(BrowserEditorInput, { id: 'no-window' }, async () => { throw new Error('No model needed'); }));
		const source = store.add(new TestFileEditorInput(URI.file('/A.cpp'), 'test.source'));
		const pair = store.add(instantiation.createInstance(BrowserSourceEditorInput, browser, source, 50));
		assert.deepStrictEqual({
			browser: browser.hasCapability(EditorInputCapabilities.NoNewWindow),
			pair: pair.hasCapability(EditorInputCapabilities.NoNewWindow),
			mixedGroup: canOpenEditorsInNewWindow([source, pair]),
			source: canOpenEditorsInNewWindow([source]),
		}, { browser: true, pair: true, mixedGroup: false, source: true });
	});

	test('browser placement redirects legacy and explicit auxiliary windows to the main window', async () => {
		const mainGroup = new TestEditorGroupView(1);
		const auxiliaryGroup = new TestEditorGroupView(2);
		const mainPart = { windowId: 1, activeGroup: mainGroup, groups: [mainGroup] };
		const configuration = new TestConfigurationService();
		let activeGroup = mainGroup;
		const controller = Object.assign(Object.create(BrowserViewWorkbenchService.prototype), {
			configurationService: configuration,
			editorGroupsService: {
				mainPart,
				get activeGroup() { return activeGroup; },
				getGroup: (id: number) => id === mainGroup.id ? mainGroup : auxiliaryGroup,
				getPart: (group: TestEditorGroupView) => group === mainGroup ? mainPart : { windowId: 2 },
			},
		}) as BrowserViewWorkbenchService;
		configuration.setUserConfiguration(BrowserNewTabPlacementSettingId, 'window');
		assert.strictEqual(await controller.getPreferredGroup(), mainGroup);
		configuration.setUserConfiguration(BrowserNewTabPlacementSettingId, 'activeGroup');
		assert.deepStrictEqual(await Promise.all([
			controller.getPreferredGroup(AUX_WINDOW_GROUP),
			controller.getPreferredGroup(auxiliaryGroup),
			controller.getPreferredGroup(auxiliaryGroup.id),
			controller.getPreferredGroup(mainGroup),
		]), [mainGroup, mainGroup, mainGroup, mainGroup]);
		activeGroup = auxiliaryGroup;
		assert.strictEqual(await controller.getPreferredGroup(ACTIVE_GROUP), mainGroup);
	});

	test('forced browser disposal restores the same dirty source as a native tab', () => {
		const { instantiation } = setup();
		const inputs: EditorInput[] = [];
		const group = new class extends TestEditorGroupView {
			override editors = inputs;
			override async replaceEditors(entries: IEditorReplacement[]) {
				assert.strictEqual(entries[0].forceReplaceDirty, true);
				inputs.splice(0, 1, entries[0].replacement as EditorInput);
			}
		}(7);
		const controller = Object.assign(Object.create(BrowserViewWorkbenchService.prototype), {
			instantiationService: instantiation, editorGroupsService: { groups: [group] },
			_known: new Map(), _onDidChangeBrowserViews: { fire() { } },
		}) as BrowserViewWorkbenchService;
		const browser = store.add(controller.getOrCreateLazy({ id: 'forced-close', url: 'https://example.com/A' }));
		const source = store.add(new TestFileEditorInput(URI.file('/A.cpp'), 'test.source'));
		source.setDirty();
		const pair = store.add(instantiation.createInstance(BrowserSourceEditorInput, browser, source, 50));
		inputs.push(pair);
		assert.strictEqual(controller['_findEditorGroupForView'](browser.id), 7);
		browser.dispose(true);
		assert.strictEqual(controller['_findEditorGroupForView'](browser.id), undefined);
		assert.deepStrictEqual({ restored: inputs[0] === source, dirty: source.isDirty(), sourceDisposed: source.isDisposed(), pairDisposed: pair.isDisposed() },
			{ restored: true, dirty: true, sourceDisposed: false, pairDisposed: true });
	});

	test('browser picker reveals and closes the owning pair through the native dirty-close path', async () => {
		const { instantiation, opened, known } = setup();
		const browser = store.add(instantiation.createInstance(BrowserEditorInput, { id: 'paired', url: 'https://example.com/A' }, async () => { throw new Error('No model needed'); }));
		known.set(browser.id, browser);
		const source = store.add(new TestFileEditorInput(URI.file('/A.cpp'), 'test.source'));
		source.setDirty();
		const pair = store.add(instantiation.createInstance(BrowserSourceEditorInput, browser, source, 50));
		let closeRequested: EditorInput | undefined;
		const group = new class extends TestEditorGroupView {
			override editors = [pair];
			override async closeEditor(editor: EditorInput) { closeRequested = editor; return false; }
		}(7);
		instantiation.stub(IEditorGroupsService, new class extends mock<IEditorGroupsService>() {
			override getGroups() { return [group]; }
			override getGroup() { return group; }
		});
		instantiation.stub(IEditorService, 'getEditors', () => [{ editor: pair, groupId: 7 }]);
		type TabItem = IQuickPickItem & { editor: BrowserEditorInput; groupId: number };
		let accept: Parameters<Event<IQuickPickDidAcceptEvent>>[0] = () => { };
		let close: Parameters<Event<IQuickPickItemButtonEvent<TabItem>>>[0] = () => { };
		const hidden = store.add(new Emitter<IQuickInputHideEvent>());
		const picker = new class extends mock<IQuickPick<TabItem, { useSeparators: true }>>() {
			override items: readonly (TabItem | IQuickPickSeparator)[] = [];
			override selectedItems: readonly TabItem[] = [];
			override activeItems: readonly TabItem[] = [];
			override readonly onDidTriggerItemButton: Event<IQuickPickItemButtonEvent<TabItem>> = listener => { close = listener; return Disposable.None; };
			override readonly onDidTriggerButton = Event.None;
			override readonly onDidAccept: Event<IQuickPickDidAcceptEvent> = listener => { accept = listener; return Disposable.None; };
			override readonly onDidHide = hidden.event;
			override show() { }
			override hide() { hidden.fire({ reason: QuickInputHideReason.Other }); }
			override dispose() { }
		};
		instantiation.stub(IQuickInputService, 'createQuickPick', () => picker);
		instantiation.invokeFunction(accessor => new QuickOpenBrowserAction().run(accessor));
		const item = picker.items.find((entry): entry is TabItem => entry.type !== 'separator' && entry.editor === browser)!;
		picker.selectedItems = [item];
		await accept({ inBackground: false });
		await close({ item, button: item.buttons![0] });
		picker.hide();
		assert.deepStrictEqual({ group: item.groupId, openedPair: opened[0]?.input === pair, closedPair: closeRequested === pair, dirty: source.isDirty(), browserDisposed: browser.isDisposed() },
			{ group: 7, openedPair: true, closedPair: true, dirty: true, browserDisposed: false });
	});

});
