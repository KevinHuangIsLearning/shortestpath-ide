/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IChannel } from '../../../../../base/parts/ipc/common/ipc.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IEditorOptions, IResourceEditorInputIdentifier } from '../../../../../platform/editor/common/editor.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IQuickInputService, IQuickPick, IQuickPickItem, IQuickPickSeparator, IQuickPickDidAcceptEvent, IQuickInputHideEvent, QuickInputHideReason } from '../../../../../platform/quickinput/common/quickInput.js';
import { IEditorGroupsService, IEmbeddedEditorPart } from '../../../../services/editor/common/editorGroupsService.js';
import { IMainProcessService } from '../../../../../platform/ipc/common/mainProcessService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IUntypedEditorInput, EditorsOrder } from '../../../../common/editor.js';
import { IEditorService, PreferredGroup, SIDE_GROUP } from '../../../../services/editor/common/editorService.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { workbenchInstantiationService, TestEditorGroupView } from '../../../../test/browser/workbenchTestServices.js';
import { BrowserEditorInput } from '../../../browserView/common/browserEditorInput.js';
import { IBrowserViewModel, IBrowserViewOpenHandler, IBrowserViewWorkbenchService } from '../../../browserView/common/browserView.js';
import { IWebviewWorkbenchService } from '../../../webviewPanel/browser/webviewWorkbenchService.js';
import { ShortestPathModeService } from '../../electron-browser/shortestPathMode.contribution.js';
import { OpenIntegratedBrowserAction, QuickOpenBrowserAction } from '../../../browserView/electron-browser/features/browserTabManagementFeatures.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
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

	test('first browsing use opens the OJ and later empty sessions keep the blank start page', async () => {
		const first = setup();
		first.service.mode = 'browse';
		await first.service.ensureBlankTab();
		assert.deepStrictEqual(first.navigations, [shortestPathHome]);
		assert.strictEqual(first.browserInputs.length, 1);
		assert.strictEqual(first.instantiation.get(IStorageService).getBoolean('shortestpath.browser.started', StorageScope.PROFILE), true);

		const returning = setup();
		returning.instantiation.get(IStorageService).store('shortestpath.browser.started', true, StorageScope.PROFILE, StorageTarget.MACHINE);
		returning.service.mode = 'browse';
		await returning.service.ensureBlankTab();
		assert.deepStrictEqual(returning.navigations, []);
		assert.strictEqual(returning.browserInputs.length, 1);
	});

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

});
