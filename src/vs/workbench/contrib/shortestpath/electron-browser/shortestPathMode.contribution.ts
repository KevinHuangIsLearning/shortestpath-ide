/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../browser/media/shortestPathMode.css';
import '../browser/problemEditorActions.js';
import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { getZoomFactor, onDidChangeZoomLevel } from '../../../../base/browser/browser.js';
import { StandardKeyboardEvent } from '../../../../base/browser/keyboardEvent.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Emitter } from '../../../../base/common/event.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { BrowserViewStorageScope, IBrowserViewService, ipcBrowserViewChannelName } from '../../../../platform/browserView/common/browserView.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { registerColor } from '../../../../platform/theme/common/colorRegistry.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';
import { IBrowserViewModel, IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';
import { BrowserOverlayManager } from '../../browserView/electron-browser/overlayManager.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { IShortestPathModeService, isRestorableBrowserUrl, parseBrowserState, shortestPathHome, ShortestPathMode } from '../common/shortestPathMode.js';
import { createNavigationHoverDelegate } from '../browser/shortestPathNavigationHover.js';
import { ShortestPathBrowserOverlay } from '../browser/shortestPathBrowserOverlay.js';
import { shouldRevealSolveEditor } from '../browser/shortestPathEditorMode.js';

const browsingContext = new RawContextKey<boolean>('shortestpath.browsing', false);
const pageContext = new RawContextKey<boolean>('shortestpath.page', false);
const modeKey = 'shortestpath.mode';
const tabsKey = 'shortestpath.browser.tabs';

registerColor('shortestpath.browseModeBackground', 'toolbar.hoverBackground', localize('sp.browseBackground', "浏览模式选中和聚焦时的背景色。"));
registerColor('shortestpath.solveModeBackground', 'toolbar.hoverBackground', localize('sp.solveBackground', "做题模式选中和聚焦时的背景色。"));
registerColor('shortestpath.snippetsModeBackground', 'toolbar.hoverBackground', localize('sp.snippetsBackground', "代码片段选中和聚焦时的背景色。"));
registerColor('shortestpath.settingsModeBackground', 'toolbar.hoverBackground', localize('sp.settingsBackground', "设置选中和聚焦时的背景色。"));
registerColor('shortestpath.activeModeForeground', 'titleBar.activeForeground', localize('sp.modeForeground', "工作模式选中和聚焦时的文字颜色。"));

/** Keeps website views alive beside, rather than inside, the code editor groups. */
class ShortestPathModeService extends Disposable implements IShortestPathModeService {
	declare readonly _serviceBrand: undefined;
	mode: ShortestPathMode = 'solve';
	activeBrowser: BrowserEditorInput | undefined;
	private readonly changeActive = this._register(new Emitter<void>());
	readonly onDidChangeActiveBrowser = this.changeActive.event;
	private readonly tabs = new Map<string, BrowserEditorInput>();
	private readonly tabStores = this._register(new DisposableMap<string, DisposableStore>());
	private readonly tabUi = this._register(new DisposableStore());
	private readonly pages = new Map<'snippets' | 'settings', WebviewInput>();
	private readonly pageStores = this._register(new DisposableMap<'snippets' | 'settings', DisposableStore>());
	private readonly pendingPages = new Map<'snippets' | 'settings', Promise<void>>();
	private readonly overlay = this._register(new BrowserOverlayManager(mainWindow));
	private readonly ready: Promise<void>;
	private surface!: HTMLElement;
	private tabBar!: HTMLElement;
	private tabList!: HTMLElement;
	private pageArea!: HTMLElement;
	private browserOverlay!: ShortestPathBrowserOverlay;
	private message!: HTMLElement;
	private address!: HTMLInputElement;
	private back!: HTMLButtonElement;
	private forward!: HTMLButtonElement;
	private refreshButton!: HTMLButtonElement;
	private browseButton!: HTMLButtonElement;
	private solveButton!: HTMLButtonElement;
	private snippetsButton!: HTMLButtonElement;
	private settingsButton!: HTMLButtonElement;
	private pageSurface!: HTMLElement;
	private resultBadge!: HTMLElement;
	private switcher!: HTMLElement;
	private navigationActions!: HTMLElement;
	private renderGeneration = 0;
	private stopped = false;
	private returnFocus: HTMLElement | undefined;
	private readonly browsing;
	private readonly pageMode;
	private readonly migrating = new Set<string>();
	private readonly nativeBrowsers: IBrowserViewService;

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IBrowserViewWorkbenchService private readonly browsers: IBrowserViewWorkbenchService,
		@IMainProcessService mainProcess: IMainProcessService,
		@IEditorService private readonly editors: IEditorService,
		@IEditorGroupsService private readonly editorGroups: IEditorGroupsService,
		@IStorageService private readonly storage: IStorageService,
		@ILifecycleService lifecycle: ILifecycleService,
		@IContextKeyService contextKeys: IContextKeyService,
		@IKeybindingService private readonly keybindings: IKeybindingService,
		@IHostService private readonly host: IHostService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IHoverService private readonly hover: IHoverService,
		@ICommandService private readonly commands: ICommandService,
		@IWebviewWorkbenchService webviews: IWebviewWorkbenchService,
	) {
		super();
		this.nativeBrowsers = ProxyChannel.toService<IBrowserViewService>(mainProcess.getChannel(ipcBrowserViewChannelName));
		this.browsing = browsingContext.bindTo(contextKeys);
		this.pageMode = pageContext.bindTo(contextKeys);
		this.ready = lifecycle.when(LifecyclePhase.Restored).then(() => this.create());
		this._register(webviews.registerOpenHandler({
			onDidChange: this.changeActive.event,
			getActiveWebview: () => this.mode === 'snippets' || this.mode === 'settings' ? this.pages.get(this.mode) : undefined,
			getViewState: input => {
				for (const [mode, page] of this.pages) {
					if (input === page) { return { visible: this.mode === mode, active: this.mode === mode }; }
				}
				return undefined;
			},
			shouldOpenEditor: (input, preserveFocus) => this.adoptPage(input, preserveFocus),
		}));
		this._register(this.browsers.registerOpenHandler({
			shouldOpenEditor: (input, owner, options) => {
				if (owner.type !== 'user' || options.auxiliaryWindow) { return true; }
				void this.showBrowser(input, !!options.background || !!options.preserveFocus).catch(onUnexpectedError);
				return false;
			}
		}));
		this._register(this.storage.onWillSaveState(() => this.saveTabs()));
		void this.ready.then(() => {
			for (const group of this.editorGroups.mainPart.groups) {
				for (const input of group.editors) {
					if (input instanceof BrowserEditorInput) { void this.migrateEditor(input).catch(onUnexpectedError); }
				}
			}
		}).catch(onUnexpectedError);
	}

	private async create(): Promise<void> {
		const root = this.layoutService.mainContainer;
		root.classList.add('shortestpath-dual-mode');
		this.switcher = append(this.layoutService.mainWindowNavigationContainer!, $('.shortestpath-mode-switch', { role: 'group', 'aria-label': localize('sp.mode', "工作模式") }));
		this.switcher.parentElement!.prepend(this.switcher);
		this.browseButton = this.button(this.switcher, localize('sp.browse', "浏览"), () => this.switchMode('browse'), 'globe');
		this.browseButton.classList.add('shortestpath-mode-browse');
		const updateSetup = () => { this.browseButton.disabled = !this.configuration.getValue<boolean>('shortestpath.setup.completed'); };
		updateSetup();
		this._register(this.configuration.onDidChangeConfiguration(event => { if (event.affectsConfiguration('shortestpath.setup.completed')) { updateSetup(); } }));
		this.solveButton = this.button(this.switcher, localize('sp.solve', "做题"), () => this.switchMode('solve'), 'code');
		this.solveButton.classList.add('shortestpath-mode-solve');
		this.resultBadge = append(this.solveButton, $('span.shortestpath-result-badge', { 'aria-hidden': 'true' }));
		this.resultBadge.hidden = true;
		this.snippetsButton = this.button(this.switcher, localize('sp.snippets', "代码片段"), () => this.switchMode('snippets'), 'snippets');
		this.snippetsButton.classList.add('shortestpath-mode-snippets');
		this.navigationActions = append(this.layoutService.mainWindowNavigationContainer!, $('.shortestpath-navigation-actions'));
		this.settingsButton = this.button(this.navigationActions, localize('sp.settings', "设置"), () => this.switchMode('settings'), 'settings-gear');
		this.settingsButton.classList.add('shortestpath-mode-settings');
		this.pageSurface = append(root, $('section.shortestpath-page-space'));
		this.pageSurface.hidden = true;
		this.surface = append(root, $('section.shortestpath-browser-space', { 'aria-label': localize('sp.browser', "网页浏览") }));
		this.surface.hidden = true;
		this.tabBar = append(this.surface, $('.shortestpath-browser-tabs'));
		this.tabList = append(this.tabBar, $('.shortestpath-browser-tab-list', { role: 'tablist', 'aria-label': localize('sp.tabs', "网页标签页") }));
		const navigation = append(this.surface, $('.shortestpath-browser-navigation'));
		this.back = this.button(navigation, localize('sp.back', "后退"), () => this.runModel(model => model.goBack()), 'arrow-left');
		this.forward = this.button(navigation, localize('sp.forward', "前进"), () => this.runModel(model => model.goForward()), 'arrow-right');
		this.refreshButton = this.button(navigation, localize('sp.reload', "刷新"), () => this.runModel(model => model.reload()), 'refresh');
		this.address = append(navigation, $('input.shortestpath-browser-address', { type: 'text', 'aria-label': localize('sp.address', "网址"), spellcheck: 'false' })) as HTMLInputElement;
		this._register(addDisposableListener(this.address, 'keydown', event => {
			if (event.key === 'Enter') {
				const value = this.address.value.trim();
				if (value) { void this.navigate(value).catch(onUnexpectedError); }
			}
		}));
		this.button(navigation, localize('sp.home', "打开 SPOJ"), () => this.openBrowser(shortestPathHome), 'mortar-board');
		this.message = append(this.surface, $('.shortestpath-browser-message', { role: 'status' }));
		this.pageArea = append(this.surface, $('.shortestpath-browser-page'));
		this.browserOverlay = this._register(new ShortestPathBrowserOverlay(this.pageArea));
		const updateTabHeight = () => {
			this.tabBar.classList.toggle('compact-height', this.editorGroups.mainPart.partOptions.tabHeight === 'compact');
			this.refresh();
		};
		updateTabHeight();
		this._register(this.editorGroups.mainPart.onDidChangeEditorPartOptions(updateTabHeight));
		this._register(this.layoutService.onDidLayoutMainContainer(() => this.layout()));
		this._register(this.layoutService.onDidChangePartVisibility(() => this.layout()));
		this._register(onDidChangeZoomLevel(() => this.layout()));
		this._register(this.overlay.onDidChangeOverlayState(() => this.refresh()));
		this._register(addDisposableListener(mainWindow, 'focus', () => this.refresh()));
		this._register(this.editors.onWillOpenEditor(event => {
			if (this.mode !== 'solve' && shouldRevealSolveEditor(event)) {
				void this.switchMode('solve').catch(onUnexpectedError);
			}
		}));
		this._register(this.editors.onDidActiveEditorChange(() => {
			const input = this.editors.activeEditor;
			if (input instanceof BrowserEditorInput) { void this.migrateEditor(input).catch(onUnexpectedError); }
		}));
		this.layout();
		const state = parseBrowserState(this.storage.get(tabsKey, StorageScope.PROFILE));
		// Native pages survive a workbench reload. Reuse them so development reloads
		// keep page state and do not leave duplicate views running in the background.
		const liveViews = await this.nativeBrowsers.getBrowserViews(mainWindow.vscodeWindowId);
		for (const [index, url] of state.urls.entries()) {
			const live = liveViews.find(view => view.owner.type === 'user' && view.id === state.ids?.[index] && !this.tabs.has(view.id))
				?? liveViews.find(view => view.owner.type === 'user' && view.state.url === url && !this.tabs.has(view.id));
			const input = live ? this.browsers.getOrCreateLazy({ id: live.id, url }) : await this.browsers.createBrowserView({ owner: { type: 'user' }, session: { scope: BrowserViewStorageScope.Global } });
			await input.resolve();
			this.adopt(input);
			// Browser tabs restore independently of code editor groups.
			if (!live) { input.navigate(url); }
		}
		this.activeBrowser = [...this.tabs.values()][state.active];
		this.renderTabs();
		const initialMode = this.storage.get(modeKey, StorageScope.PROFILE);
		const configured = this.configuration.getValue<boolean>('shortestpath.setup.completed');
		if (initialMode === 'snippets' || initialMode === 'settings') {
			this.applyMode('solve');
			void this.ready.then(() => this.switchMode(initialMode)).catch(onUnexpectedError);
		} else if (configured && initialMode !== 'solve') {
			this.applyMode('browse');
			if (!this.activeBrowser) { void this.openBrowser().catch(onUnexpectedError); }
		} else { this.applyMode('solve'); }
	}

	private button(parent: HTMLElement, label: string, run: () => PromiseLike<unknown> | void, icon?: string, store: DisposableStore = this._store): HTMLButtonElement {
		const button = append(parent, $('button', { type: 'button', 'aria-label': label })) as HTMLButtonElement;
		if ((parent === this.switcher || parent === this.navigationActions) && (icon === 'globe' || icon === 'code' || icon === 'snippets' || icon === 'settings-gear')) {
			const svg = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.classList.add('shortestpath-mode-icon');
			svg.setAttribute('viewBox', '0 0 24 24');
			svg.setAttribute('aria-hidden', 'true');
			svg.setAttribute('focusable', 'false');
			const path = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', icon === 'globe'
				? 'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM3 9h18M7 6.5h.01M10 6.5h.01'
				: icon === 'snippets'
					? 'M8 3h11a2 2 0 0 1 2 2v12M5 7h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2ZM8 11l-3 3 3 3M13 11l3 3-3 3'
					: icon === 'settings-gear'
						? 'M9.5 2h5l.6 2.4 2.1 1.2 2.4-.7 2.5 4.3-1.8 1.6v2.4l1.8 1.6-2.5 4.3-2.4-.7-2.1 1.2-.6 2.4h-5l-.6-2.4-2.1-1.2-2.4.7-2.5-4.3 1.8-1.6v-2.4L1.9 9.2l2.5-4.3 2.4.7 2.1-1.2L9.5 2ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'
						: 'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM9 9l-3 3 3 3M15 9l3 3-3 3');
			svg.append(path);
			button.append(svg);
		} else if (icon) { append(button, $(`span.codicon.codicon-${icon}`, { 'aria-hidden': 'true' })); }
		else { button.textContent = label; }
		const hoverDelegate = parent === this.switcher || parent === this.navigationActions
			? createNavigationHoverDelegate(this.hover)
			: getDefaultHoverDelegate('mouse');
		store.add(this.hover.setupManagedHover(hoverDelegate, button, label));
		store.add(addDisposableListener(button, 'click', () => { void Promise.resolve(run()).catch(onUnexpectedError); }));
		return button;
	}

	async switchMode(mode: ShortestPathMode): Promise<void> {
		await this.ready;
		if (this.stopped) { return; }
		if (mode === 'browse' && !this.configuration.getValue<boolean>('shortestpath.setup.completed')) { return; }
		this.applyMode(mode);
		if (mode === 'browse') {
			if (!this.activeBrowser) { await this.openBrowser(); }
			else { await this.activeBrowser.model?.focus(); }
		} else if (mode === 'snippets' || mode === 'settings') {
			try {
				if (!this.pages.has(mode)) {
					let pending = this.pendingPages.get(mode);
					if (!pending) {
						pending = this.commands.executeCommand<void>(mode === 'snippets' ? 'shortestpath.configureCppSnippets' : 'shortestpath.openSettings');
						this.pendingPages.set(mode, pending);
						void pending.finally(() => this.pendingPages.delete(mode)).catch(onUnexpectedError);
					}
					await pending;
				}
				if (this.mode === mode) {
					const page = this.pages.get(mode);
					if (page) { this.showPage(page); page.webview.focus(); }
					else { this.applyMode('solve'); }
				}
			} catch (error) {
				if (this.mode === mode) { this.applyMode('solve'); }
				throw error;
			}
		} else {
			this.resultBadge.hidden = true;
			this.solveButton.setAttribute('aria-label', localize('sp.solve', "做题"));
			if (this.returnFocus?.isConnected) { this.returnFocus.focus(); }
			else { this.layoutService.focusPart(Parts.EDITOR_PART, mainWindow); }
		}
	}

	private applyMode(mode: ShortestPathMode): void {
		if (this.mode === 'solve' && mode !== 'solve') {
			const active = mainWindow.document.activeElement;
			this.returnFocus = active instanceof mainWindow.HTMLElement && !this.switcher.contains(active) && !this.navigationActions.contains(active) ? active : undefined;
		}
		this.mode = mode;
		this.browsing.set(mode === 'browse');
		this.pageMode.set(mode === 'snippets' || mode === 'settings');
		this.layoutService.mainContainer.classList.toggle('shortestpath-browsing', mode === 'browse');
		this.layoutService.mainContainer.classList.toggle('shortestpath-page-mode', mode === 'snippets' || mode === 'settings');
		this.surface.hidden = mode !== 'browse';
		this.pageSurface.hidden = mode !== 'snippets' && mode !== 'settings';
		this.pageSurface.setAttribute('aria-label', mode === 'snippets' ? localize('sp.snippets', "代码片段") : localize('sp.settings', "设置"));
		this.browseButton.setAttribute('aria-pressed', String(mode === 'browse'));
		this.solveButton.setAttribute('aria-pressed', String(mode === 'solve'));
		this.snippetsButton.setAttribute('aria-pressed', String(mode === 'snippets'));
		this.settingsButton.setAttribute('aria-pressed', String(mode === 'settings'));
		for (const [pageMode, input] of this.pages) {
			if (mode === pageMode) { this.showPage(input); }
			else { input.webview.release(this); }
		}
		for (const part of [Parts.EDITOR_PART, Parts.SIDEBAR_PART, Parts.PANEL_PART, Parts.ACTIVITYBAR_PART, Parts.AUXILIARYBAR_PART, Parts.STATUSBAR_PART]) {
			const element = this.layoutService.getContainer(mainWindow, part);
			if (element) { element.inert = mode !== 'solve'; }
		}
		this.storage.store(modeKey, mode, StorageScope.PROFILE, StorageTarget.MACHINE);
		this.changeActive.fire();
		this.refresh();
	}

	private adoptPage(input: WebviewInput, preserveFocus: boolean): boolean {
		if (input.extension?.id.value.toLowerCase() !== 'shortestpath.shortestpath-setup') { return true; }
		const mode = input.webview.providedViewType === 'shortestpath.cppSnippets' ? 'snippets'
			: input.webview.providedViewType === 'shortestpath.settings' ? 'settings' : undefined;
		if (!mode) { return true; }
		if (this.pages.get(mode) !== input) {
			const previous = this.pages.get(mode);
			this.pages.set(mode, input);
			previous?.dispose();
			const store = new DisposableStore();
			this.pageStores.set(mode, store);
			store.add(input.onWillDispose(() => {
				if (this.pages.get(mode) === input) {
					this.pages.delete(mode);
					this.pageStores.deleteAndDispose(mode);
					if (!this.stopped && this.mode === mode) { void this.switchMode('solve').catch(onUnexpectedError); }
				}
			}));
		}
		const pending = this.pendingPages.has(mode);
		void this.ready.then(() => {
			if (this.stopped || input.isDisposed()) { return; }
			if (!preserveFocus && (!pending || this.mode === mode)) { this.applyMode(mode); }
			if (this.mode === mode) {
				this.showPage(input);
				if (!preserveFocus) { input.webview.focus(); }
			}
			this.changeActive.fire();
		}).catch(onUnexpectedError);
		return false;
	}

	private showPage(input: WebviewInput): void {
		input.claim(this, mainWindow, undefined);
		input.webview.container.classList.add('shortestpath-page-webview');
		// The fixed page bounds already constrain the webview. A clipping root would
		// create a stacking context underneath the opaque page surface.
		input.webview.setAnchorElement(this.pageSurface);
	}

	async openBrowser(url = shortestPathHome, newTab = false, preserveFocus = false): Promise<BrowserEditorInput> {
		await this.ready;
		let input = !newTab ? [...this.tabs.values()].find(tab => tab.url === url) : undefined;
		if (!input) {
			input = await this.browsers.createBrowserView({ owner: { type: 'user' }, session: { scope: BrowserViewStorageScope.Global } });
			this.adopt(input);
			void input.model!.loadURL(url).catch(onUnexpectedError);
		}
		await this.showBrowser(input, preserveFocus);
		return input;
	}

	private async migrateEditor(input: BrowserEditorInput): Promise<void> {
		if (this.migrating.has(input.id)) { return; }
		const groups = this.editorGroups.mainPart.groups.filter(group => group.editors.includes(input));
		if (!groups.length) { return; }
		this.migrating.add(input.id);
		try {
			// Older profiles and generic editor links can still open a browser editor.
			// Transfer its URL to the shared browser space before closing that editor.
			await this.openBrowser(input.url ?? shortestPathHome, false, this.editors.activeEditor !== input);
			for (const group of groups) { await group.closeEditor(input, { preserveFocus: true }); }
		} finally { this.migrating.delete(input.id); }
	}

	async showBrowser(input: BrowserEditorInput, preserveFocus = false): Promise<void> {
		await this.ready;
		if (this.stopped || input.isDisposed()) { return; }
		this.adopt(input);
		if (!this.configuration.getValue<boolean>('shortestpath.setup.completed')) { return; }
		if (!preserveFocus) {
			this.activeBrowser = input;
			this.applyMode('browse');
			await this.host.focus(mainWindow);
		}
		await input.resolve();
		this.renderTabs();
		this.changeActive.fire();
		this.refresh();
		if (!preserveFocus && this.mode === 'browse' && this.activeBrowser === input) { await input.model?.focus(); }
	}

	private adopt(input: BrowserEditorInput): void {
		if (this.tabs.has(input.id)) { return; }
		this.tabs.set(input.id, input);
		const store = new DisposableStore();
		this.tabStores.set(input.id, store);
		store.add(input.onDidChangeLabel(() => { this.renderTabs(); this.refresh(); this.saveTabs(); }));
		store.add(input.onDidResolveModel(model => this.trackModel(input, model, store)));
		if (input.model) { this.trackModel(input, input.model, store); }
		store.add(input.onWillDispose(() => {
			this.tabs.delete(input.id);
			this.tabStores.deleteAndDispose(input.id);
			if (this.activeBrowser === input) { this.activeBrowser = [...this.tabs.values()].at(-1); }
			if (!this.stopped) { this.renderTabs(); this.changeActive.fire(); this.refresh(); this.saveTabs(); }
		}));
	}

	private trackModel(input: BrowserEditorInput, model: IBrowserViewModel, store: DisposableStore): void {
		store.add(model.onDidNavigate(() => this.refresh()));
		store.add(model.onDidChangeLoadingState(() => this.refresh()));
		store.add(model.onDidKeyCommand(event => {
			if (this.mode === 'browse' && this.activeBrowser === input) {
				this.keybindings.dispatchEvent(new StandardKeyboardEvent(new mainWindow.KeyboardEvent('keydown', event)), this.surface);
			}
		}));
	}

	private renderTabs(): void {
		this.tabUi.clear();
		this.tabBar.replaceChildren(this.tabList);
		this.tabList.replaceChildren();
		for (const input of this.tabs.values()) {
			const tab = append(this.tabList, $('.shortestpath-browser-tab'));
			tab.classList.toggle('active', input === this.activeBrowser);
			append(tab, $('span.shortestpath-browser-tab-fill', { 'aria-hidden': 'true' }));
			const select = this.button(tab, input.getName(), () => this.showBrowser(input), undefined, this.tabUi);
			select.setAttribute('role', 'tab');
			select.setAttribute('aria-selected', String(input === this.activeBrowser));
			select.classList.add('shortestpath-browser-tab-label');
			this.button(tab, localize('sp.closeTab', "关闭 {0}", input.getName()), () => input.dispose(true), 'close', this.tabUi).classList.add('shortestpath-browser-tab-close');
		}
		this.button(this.tabBar, localize('sp.newTab', "新建网页标签页"), () => this.openBrowser(shortestPathHome, true), 'add', this.tabUi).classList.add('shortestpath-browser-tab-add');
	}

	private layout(): void {
		if (!this.surface) { return; }
		const navigation = this.layoutService.mainWindowNavigationContainer!.getBoundingClientRect();
		const root = this.layoutService.mainContainer.getBoundingClientRect();
		this.surface.style.top = `${navigation.top - root.top}px`;
		this.surface.style.left = `${navigation.right - root.left}px`;
		this.pageSurface.style.top = this.surface.style.top;
		this.pageSurface.style.left = this.surface.style.left;
		this.refresh();
	}

	private refresh(): void {
		if (!this.pageArea || this.stopped) { return; }
		const generation = ++this.renderGeneration;
		const model = this.activeBrowser?.model;
		if (mainWindow.document.activeElement !== this.address) { this.address.value = model?.url ?? this.activeBrowser?.url ?? ''; }
		this.back.disabled = !model?.canGoBack;
		this.forward.disabled = !model?.canGoForward;
		this.refreshButton.disabled = !model;
		const obscured = this.overlay.getOverlappingOverlays(this.pageArea).length > 0;
		this.message.textContent = model?.error ? localize('sp.loadError', "网页加载失败，请刷新后重试。") : !model ? localize('sp.emptyBrowser', "点击 + 打开网页。") : '';
		const active = this.mode === 'browse' && !!model && !model.error;
		void this.browserOverlay.update(active ? model : undefined, obscured).catch(onUnexpectedError);
		for (const input of this.tabs.values()) {
			if (input.model && (input !== this.activeBrowser || !active) && input.model.visible) { void input.model.setVisible(false).catch(onUnexpectedError); }
		}
		if (active && !obscured && model) {
			const bounds = this.pageArea.getBoundingClientRect();
			void model.layout({ windowId: mainWindow.vscodeWindowId, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, zoomFactor: getZoomFactor(mainWindow), cornerRadius: 0 }).then(() => {
				if (generation === this.renderGeneration && !this.stopped) { return model.setVisible(true); }
				return undefined;
			}).catch(onUnexpectedError);
		}
	}

	private async navigate(url: string): Promise<void> {
		if (!this.activeBrowser?.model) { await this.openBrowser(url); return; }
		await this.activeBrowser.model.loadURL(url);
		this.refresh();
		await this.activeBrowser.model.focus();
	}

	private runModel(run: (model: IBrowserViewModel) => Promise<void>): Promise<void> | undefined {
		const model = this.activeBrowser?.model;
		return model ? run(model) : undefined;
	}

	private saveTabs(): void {
		if (this.stopped) { return; }
		const saved = [...this.tabs.values()].filter(tab => isRestorableBrowserUrl(tab.url ?? ''));
		this.storage.store(tabsKey, JSON.stringify({ urls: saved.map(tab => tab.url), ids: saved.map(tab => tab.id), active: Math.max(0, saved.indexOf(this.activeBrowser!)) }), StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	notifyResult(): void {
		if (this.mode === 'browse') {
			this.resultBadge.hidden = false;
			this.solveButton.setAttribute('aria-label', localize('sp.newResult', "做题，有新的评测结果"));
		}
	}

	focusAddress(): void { this.address.focus(); this.address.select(); }
	closeActiveTab(): void { this.activeBrowser?.dispose(true); }

	override dispose(): void {
		this.saveTabs();
		this.stopped = true;
		for (const input of [...this.tabs.values()]) { input.dispose(true); }
		for (const input of [...this.pages.values()]) { input.dispose(); }
		this.surface?.remove();
		this.pageSurface?.remove();
		this.switcher?.remove();
		this.navigationActions?.remove();
		super.dispose();
	}
}

registerSingleton(IShortestPathModeService, ShortestPathModeService, InstantiationType.Delayed);

class ShortestPathModeContribution {
	static readonly ID = 'workbench.contrib.shortestpathModes';
	constructor(@IShortestPathModeService _modeService: IShortestPathModeService) { }
}
registerWorkbenchContribution2(ShortestPathModeContribution.ID, ShortestPathModeContribution, WorkbenchPhase.AfterRestored);

const modeTitles = {
	browse: localize2('sp.switchBrowse', "切换到浏览模式"),
	solve: localize2('sp.switchSolve', "切换到做题模式"),
	snippets: localize2('sp.switchSnippets', "打开代码片段"),
	settings: localize2('sp.switchSettings', "打开设置"),
};
for (const mode of ['browse', 'solve', 'snippets', 'settings'] as const) {
	registerAction2(class extends Action2 {
		constructor() { super({ id: `shortestpath.mode.${mode}`, title: modeTitles[mode], f1: true }); }
		run(accessor: ServicesAccessor): Promise<void> { return accessor.get(IShortestPathModeService).switchMode(mode); }
	});
}
registerAction2(class extends Action2 {
	constructor() { super({ id: 'shortestpath.mode.toggle', title: localize2('sp.toggleMode', "切换浏览 / 做题模式"), f1: true, keybinding: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Space, weight: KeybindingWeight.WorkbenchContrib } }); }
	run(accessor: ServicesAccessor): Promise<void> { const service = accessor.get(IShortestPathModeService); return service.switchMode(service.mode === 'browse' ? 'solve' : 'browse'); }
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'shortestpath.page.back',
			title: localize2('sp.backToSolve', "返回做题"),
			precondition: pageContext,
			keybinding: { primary: KeyMod.CtrlCmd | KeyCode.KeyW, when: pageContext, weight: KeybindingWeight.WorkbenchContrib + 1 },
		});
	}
	run(accessor: ServicesAccessor): Promise<void> { return accessor.get(IShortestPathModeService).switchMode('solve'); }
});

CommandsRegistry.registerCommand('shortestpath.browser.open', (accessor, url?: string, newTab?: boolean) => accessor.get(IShortestPathModeService).openBrowser(url, newTab));
CommandsRegistry.registerCommand('shortestpath.mode.notifyResult', accessor => accessor.get(IShortestPathModeService).notifyResult());
for (const [id, title, primary, run] of [
	['address', localize2('sp.focusAddress', "浏览：聚焦地址栏"), KeyMod.CtrlCmd | KeyCode.KeyL, (service: ShortestPathModeService) => service.focusAddress()],
	['newTab', localize2('sp.openTab', "浏览：新建标签页"), KeyMod.CtrlCmd | KeyCode.KeyT, (service: ShortestPathModeService) => service.openBrowser(shortestPathHome, true)],
	['closeTab', localize2('sp.closeActive', "浏览：关闭标签页"), KeyMod.CtrlCmd | KeyCode.KeyW, (service: ShortestPathModeService) => service.closeActiveTab()],
] as const) {
	registerAction2(class extends Action2 {
		constructor() { super({ id: `shortestpath.browser.${id}`, title, f1: true, precondition: browsingContext, keybinding: { primary, when: browsingContext, weight: KeybindingWeight.WorkbenchContrib + 1 } }); }
		run(accessor: ServicesAccessor) { return run(accessor.get(IShortestPathModeService) as ShortestPathModeService); }
	});
}
