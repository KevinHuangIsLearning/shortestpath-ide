/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../browser/media/shortestPathMode.css';
import '../browser/problemEditorActions.js';
import { $, addDisposableListener, append, EventHelper, EventType, isHTMLElement } from '../../../../base/browser/dom.js';
import { onDidChangeZoomLevel } from '../../../../base/browser/browser.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { IAction } from '../../../../base/common/actions.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { getBrowserEditor } from '../../browserView/electron-browser/browserEditor.js';
import { BrowserNavigationFeatures } from '../../browserView/electron-browser/features/browserNavigationFeatures.js';
import { ShortestPathBrowserNewTabOverlay, BrowserNewTabEntry } from '../browser/shortestPathBrowserNewTabOverlay.js';
import { BrowserSearchEngineId, BrowserSearchEngineSettingId, getBrowserNavigationChoices } from '../../browserView/common/browserSearch.js';
import { BrowserFavoritesStore } from '../../browserView/electron-browser/features/browserFavoritesFeature.js';
import { browserTabBarLabels, BrowserTabBarItem, ShortestPathBrowserTabBar } from '../browser/shortestPathBrowserTabBar.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, DisposableMap, DisposableStore, MutableDisposable, toDisposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { getNLSLanguage, localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { BrowserViewCommandId, BrowserViewStorageScope, IBrowserViewService, ipcBrowserViewChannelName } from '../../../../platform/browserView/common/browserView.js';
import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { registerColor } from '../../../../platform/theme/common/colorRegistry.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { IEditorService, PreferredGroup } from '../../../services/editor/common/editorService.js';
import { GroupsOrder, IEditorGroup, IEmbeddedEditorPart, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IPaneCompositePartService } from '../../../services/panecomposite/browser/panecomposite.js';
import { ViewContainerLocation } from '../../../common/views.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { EditorsOrder, IEditorWillOpenEvent } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';
import { BrowserSourceEditorInput } from '../../browserView/common/browserSourceEditorInput.js';
import { IBrowserViewWorkbenchService } from '../../browserView/common/browserView.js';
import { WebviewInput } from '../../webviewPanel/browser/webviewEditorInput.js';
import { IWebviewWorkbenchService } from '../../webviewPanel/browser/webviewWorkbenchService.js';
import { getShortestPathPageMode, IShortestPathModeService, isRestorableBrowserUrl, isShortestPathPageMode, parseBrowserState, shortestPathHome, shortestPathPageCommands, ShortestPathMode, ShortestPathPageMode } from '../common/shortestPathMode.js';
import { createNavigationHoverDelegate } from '../browser/shortestPathNavigationHover.js';
import { registerNavigationExpansion, registerNavigationSwipe } from '../browser/shortestPathNavigationSwipe.js';
import { shouldRevealSolveEditor } from '../browser/shortestPathEditorMode.js';
import { generateUuid } from '../../../../base/common/uuid.js';

const browsingContext = new RawContextKey<boolean>('shortestpath.browsing', false);
const drawingContext = new RawContextKey<boolean>('shortestpath.drawMode', false);
const pageContext = new RawContextKey<boolean>('shortestpath.page', false);
const modeKey = 'shortestpath.mode';
const tabsKey = 'shortestpath.browser.tabs';
const drawingTabsKey = 'shortestpath.draw.tabs';
const verticalTabsKey = 'shortestpath.browser.verticalTabs';
// allow-any-unicode-next-line
const drawLabel = getNLSLanguage()?.toLowerCase().startsWith('zh') ? '草稿' : localize('sp.draw', "Sketchpad");
// allow-any-unicode-next-line
const dashboardLabel = getNLSLanguage()?.toLowerCase().startsWith('zh') ? '做题统计' : localize('sp.dashboard', "Dashboard");
const drawTitle = localize2('sp.switchDraw', "Open Sketchpad");
// allow-any-unicode-next-line
if (getNLSLanguage()?.toLowerCase().startsWith('zh')) { drawTitle.value = '打开草稿'; }

// allow-any-unicode-next-line
registerColor('shortestpath.browseModeBackground', 'toolbar.hoverBackground', localize('sp.browseBackground', "浏览模式选中和聚焦时的背景色。"));
// allow-any-unicode-next-line
registerColor('shortestpath.solveModeBackground', 'toolbar.hoverBackground', localize('sp.solveBackground', "做题模式选中和聚焦时的背景色。"));
// allow-any-unicode-next-line
registerColor('shortestpath.snippetsModeBackground', 'toolbar.hoverBackground', localize('sp.snippetsBackground', "代码片段选中和聚焦时的背景色。"));
// allow-any-unicode-next-line
registerColor('shortestpath.drawModeBackground', 'toolbar.hoverBackground', getNLSLanguage()?.toLowerCase().startsWith('zh') ? '草稿选中和聚焦时的背景色。' : localize('sp.drawBackground', "Background of the sketchpad button when selected or focused."));
// allow-any-unicode-next-line
registerColor('shortestpath.settingsModeBackground', 'toolbar.hoverBackground', localize('sp.settingsBackground', "设置选中和聚焦时的背景色。"));
// allow-any-unicode-next-line
registerColor('shortestpath.activeModeForeground', 'titleBar.activeForeground', localize('sp.modeForeground', "工作模式选中和聚焦时的文字颜色。"));

/** Hosts browsing in native editor groups independent from the solving workspace. */
export class ShortestPathModeService extends Disposable implements IShortestPathModeService {
	declare readonly _serviceBrand: undefined;
	mode: ShortestPathMode = 'solve';
	activeBrowser: BrowserEditorInput | undefined;
	private readonly changeTabVisibility = this._register(new Emitter<void>());
	private readonly changeActive = this._register(new Emitter<void>());
	readonly onDidChangeActiveBrowser = this.changeActive.event;
	private readonly tabs = new Map<string, BrowserEditorInput>();
	private readonly tabStores = this._register(new DisposableMap<string, DisposableStore>());
	private readonly browserGroupStores = this._register(new DisposableMap<number, DisposableStore>());
	private readonly openingTabs = new Set<string>();
	private restoringBrowserTabs = false;
	protected browserPart: IEmbeddedEditorPart | undefined;
	protected drawingPart: IEmbeddedEditorPart | undefined;
	private restoringDrawingTabs = false;
	private drawingTabsReady: Promise<void> | undefined;
	private drawingTabsRestored = false;
	private readonly pendingDrawingEditors = new Set<Promise<unknown>>();
	private readonly drawingTabStores = this._register(new DisposableMap<WebviewInput, DisposableStore>());
	private readonly drawingEditorOptions = new WeakMap<EditorInput, IEditorOptions>();
	private readonly drawingGroupStores = this._register(new DisposableMap<number, DisposableStore>());
	private readonly groupTabBars = new Map<number, ShortestPathBrowserTabBar>();
	private readonly newTabPicker = this._register(new MutableDisposable<ShortestPathBrowserNewTabOverlay>());
	private readonly browserTabOptions = this._register(new MutableDisposable<IDisposable>());
	private readonly verticalBars = this._register(new DisposableMap<number, DisposableStore>());
	private verticalTabs = false;
	private browserHost: HTMLElement | undefined;
	private favorites: BrowserFavoritesStore | undefined;
	private readonly favoriteTabs = new Map<string, BrowserEditorInput>();
	private emptyTabPromise: Promise<void> | undefined;
	private readonly pages = new Map<ShortestPathPageMode, WebviewInput>();
	private readonly pageStores = this._register(new DisposableMap<ShortestPathPageMode, DisposableStore>());
	private readonly pendingPages = new Map<ShortestPathPageMode, Promise<void>>();
	private readonly ready: Promise<void>;
	private requestedMode: ShortestPathMode | undefined;
	private surface!: HTMLElement;
	private browseButton!: HTMLButtonElement;
	private solveButton!: HTMLButtonElement;
	private snippetsButton!: HTMLButtonElement;
	private drawButton!: HTMLButtonElement;
	private dashboardButton!: HTMLButtonElement;
	private settingsButton!: HTMLButtonElement;
	private previousPageButton: HTMLButtonElement | undefined;
	private nextPageButton: HTMLButtonElement | undefined;
	private pageSurface!: HTMLElement;
	private drawingSurface!: HTMLElement;
	private resultBadge!: HTMLElement;
	private switcher!: HTMLElement;
	private navigationActions!: HTMLElement;
	private stopped = false;
	private returnFocus: HTMLElement | undefined;
	private readonly browsing;
	private readonly pageMode;
	private readonly drawing;
	private drawingSidebar: { id: string; visible: boolean } | undefined;
	private sidebarTransition: Promise<void> = Promise.resolve();
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
		@IHostService private readonly host: IHostService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IHoverService private readonly hover: IHoverService,
		@ICommandService private readonly commands: ICommandService,
		@IWebviewWorkbenchService webviews: IWebviewWorkbenchService,
		@IContextMenuService private readonly contextMenu: IContextMenuService,
		@IPaneCompositePartService private readonly paneComposites: IPaneCompositePartService,
	) {
		super();
		this.nativeBrowsers = ProxyChannel.toService<IBrowserViewService>(mainProcess.getChannel(ipcBrowserViewChannelName));
		this.browsing = browsingContext.bindTo(contextKeys);
		this.pageMode = pageContext.bindTo(contextKeys);
		this.drawing = drawingContext.bindTo(contextKeys);
		this.ready = lifecycle.when(LifecyclePhase.Ready).then(async () => {
			if (this.stopped) { return; }
			// Show navigation with the workbench shell; native tabs still restore later.
			this.createNavigation();
			await lifecycle.when(LifecyclePhase.Restored);
			if (!this.stopped) { await this.create(); }
		});
		this._register(webviews.registerOpenHandler({
			onDidChange: this.changeActive.event,
			getActiveWebview: () => isShortestPathPageMode(this.mode) ? this.pages.get(this.mode) : undefined,
			getViewState: input => {
				const drawingGroup = this.drawingPart?.groups.find(group => group.contains(input));
				if (drawingGroup) { return { visible: this.mode === 'draw' && drawingGroup.activeEditor === input, active: this.mode === 'draw' && this.drawingPart?.activeGroup === drawingGroup && drawingGroup.activeEditor === input }; }
				for (const [mode, page] of this.pages) {
					if (input === page) { return { visible: this.mode === mode, active: this.mode === mode }; }
				}
				return undefined;
			},
			shouldOpenEditor: (input, preserveFocus) => this.adoptPage(input, preserveFocus),
		}));
		this._register(this.browsers.registerOpenHandler({
			shouldOpenEditor: (input, owner, options) => {
				const fromProblem = options.parentViewId && this.editors.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).some(({ editor }) =>
					editor instanceof BrowserSourceEditorInput && (editor.secondary as BrowserEditorInput).id === options.parentViewId);
				if (fromProblem) {
					void this.switchMode('browse').then(() => this.showBrowser(input, false)).catch(onUnexpectedError);
					return false;
				}
				if (this.mode === 'solve' || owner.type !== 'user') { return true; }
				void this.showBrowser(input, !!options.background || !!options.preserveFocus).catch(onUnexpectedError);
				return false;
			}
		}));
		this._register(this.storage.onWillSaveState(() => { this.saveTabs(); this.saveDrawingTabs(); }));
	}

	protected createNavigation(): void {
		const root = this.layoutService.mainContainer;
		root.classList.add('shortestpath-dual-mode');
		// allow-any-unicode-next-line
		this.switcher = append(this.layoutService.mainWindowNavigationContainer!, $('.shortestpath-mode-switch', { role: 'group', 'aria-label': localize('sp.mode', "工作模式") }));
		this.switcher.parentElement!.prepend(this.switcher);
		// allow-any-unicode-next-line
		this.browseButton = this.button(this.switcher, localize('sp.browse', "浏览"), () => this.switchMode('browse'), 'globe');
		this.browseButton.classList.add('shortestpath-mode-browse');
		const updateSetup = () => { this.browseButton.disabled = !this.configuration.getValue<boolean>('shortestpath.setup.completed'); this.updateNavigationHints(); };
		updateSetup();
		this._register(this.configuration.onDidChangeConfiguration(event => { if (event.affectsConfiguration('shortestpath.setup.completed')) { updateSetup(); } }));
		// allow-any-unicode-next-line
		this.solveButton = this.button(this.switcher, localize('sp.solve', "做题"), () => this.switchMode('solve'), 'code');
		this.solveButton.classList.add('shortestpath-mode-solve');
		this.resultBadge = append(this.solveButton, $('span.shortestpath-result-badge', { 'aria-hidden': 'true' }));
		this.resultBadge.hidden = true;
		// allow-any-unicode-next-line
		this.snippetsButton = this.button(this.switcher, localize('sp.snippets', "代码片段"), () => this.switchMode('snippets'), 'snippets');
		this.snippetsButton.classList.add('shortestpath-mode-snippets');
		this.drawButton = this.button(this.switcher, drawLabel, () => this.switchMode('draw'), 'pencil');
		this.drawButton.classList.add('shortestpath-mode-draw');
		this.dashboardButton = this.button(this.switcher, dashboardLabel, () => this.switchMode('dashboard'), 'dashboard');
		this.dashboardButton.classList.add('shortestpath-mode-dashboard');
		this.navigationActions = append(this.layoutService.mainWindowNavigationContainer!, $('.shortestpath-navigation-actions'));
		// allow-any-unicode-next-line
		this.settingsButton = this.button(this.navigationActions, localize('sp.settings', "设置"), () => this.switchMode('settings'), 'settings-gear');
		this.settingsButton.classList.add('shortestpath-mode-settings');
		this.solveButton.setAttribute('aria-pressed', 'true');
		const navigation = this.layoutService.mainWindowNavigationContainer!;
		// allow-any-unicode-next-line
		this.previousPageButton = this.button(navigation, localize('sp.previousPage', "上一页"), () => this.switchNavigationPage(-1), 'chevron-left');
		this.previousPageButton.classList.add('shortestpath-navigation-hint');
		navigation.prepend(this.previousPageButton);
		// allow-any-unicode-next-line
		this.nextPageButton = this.button(navigation, localize('sp.nextPage', "下一页"), () => this.switchNavigationPage(1), 'chevron-right');
		this.nextPageButton.classList.add('shortestpath-navigation-hint', 'shortestpath-navigation-hint-right');
		this.updateNavigationHints();
		this._register(registerNavigationExpansion(navigation));
		this._register(registerNavigationSwipe(navigation, direction => { void Promise.resolve(this.switchNavigationPage(direction)).catch(onUnexpectedError); }, [this.browseButton, this.solveButton, this.snippetsButton, this.drawButton, this.dashboardButton, this.settingsButton]));
	}

	protected async create(): Promise<void> {
		const root = this.layoutService.mainContainer;
		this.pageSurface = append(root, $('section.shortestpath-page-space'));
		this.pageSurface.hidden = true;
		this.drawingSurface = append(this.pageSurface, $('.shortestpath-drawing-space'));
		// allow-any-unicode-next-line
		this.surface = append(root, $('section.shortestpath-browser-space', { 'aria-label': localize('sp.browser', "网页浏览") }));
		this.surface.hidden = true;
		this.surface.inert = true;
		this.favorites = this._register(new BrowserFavoritesStore(this.storage));
		this.browserHost = append(this.surface, $('.shortestpath-browser-host'));
		this.createBrowserPart(this.browserHost);
		this.setVerticalTabs(false);
		this._register(this.favorites.onDidChange(() => this.updateTabBar()));
		this.registerLayoutListeners();
		this._register(addDisposableListener(mainWindow, 'focus', () => this.refresh()));
		this._register(this.editors.onWillOpenEditor(event => this.revealEditorMode(event)));
		this.layout();
		await this.restoreBrowserTabs();
		this.renderTabs();
		this.restoreMode();
	}

	protected async restoreBrowserTabs(): Promise<void> {
		this.restoringBrowserTabs = true;
		try {
			const state = parseBrowserState(this.storage.get(tabsKey, StorageScope.PROFILE));
			// Native pages survive a workbench reload. Reuse them so development reloads
			// keep page state and do not leave duplicate views running in the background.
			const liveViews = await this.nativeBrowsers.getBrowserViews(mainWindow.vscodeWindowId);
			const restored: BrowserEditorInput[] = [];
			for (const [index, url] of state.urls.entries()) {
				const live = liveViews.find(view => view.owner.type === 'user' && view.id === state.ids?.[index] && !this.tabs.has(view.id) && !this.editors.isOpened(this.browsers.getOrCreateLazy({ id: view.id, url: view.state.url })))
					?? liveViews.find(view => view.owner.type === 'user' && view.state.url === url && !this.tabs.has(view.id) && !this.editors.isOpened(this.browsers.getOrCreateLazy({ id: view.id, url: view.state.url })));
				const input = live ? this.browsers.getOrCreateLazy({ id: live.id, url }) : this.browsers.getOrCreateLazy({ id: generateUuid(), url }, {
					owner: { type: 'user' }, session: { scope: BrowserViewStorageScope.Global }, initialUrl: url
				});
				// Bind surviving native views so closing an inactive reload tab also disposes its renderer.
				if (live) { await input.resolve(); }
				this.adopt(input);
				restored.push(input);
			}
			// Open the selected editor first; inactive tabs retain their URL and native
			// session options but allocate a renderer only when the user selects them.
			this.activeBrowser = restored[state.active];
			if (this.activeBrowser) { await this.openInBrowserPart(this.activeBrowser, true, false, state.active); }
			for (const [index, input] of restored.entries()) {
				if (input !== this.activeBrowser) { await this.openInBrowserPart(input, true, true, index); }
			}
		} finally { this.restoringBrowserTabs = false; }
	}

	/** Restore the hidden drawing editors only when Sketchpad is first used. */
	protected restoreDrawingTabs(): Promise<void> {
		return this.drawingTabsReady ??= Promise.resolve().then(async () => {
			if (this.stopped) { return; }
			this.restoringDrawingTabs = true;
			try {
				if (!this.drawingPart) { this.createDrawingPart(this.drawingSurface); }
				const drawingState = this.storage.get(drawingTabsKey, StorageScope.WORKSPACE);
				if (!drawingState) { this.drawingTabsRestored = true; return; }
				let saved: { ids?: unknown; active?: unknown };
				try { saved = JSON.parse(drawingState) ?? {}; }
				catch (error) { onUnexpectedError(error); saved = {}; }
				if (Array.isArray(saved.ids) && saved.ids.every(id => typeof id === 'string')) {
					const ids = [...new Set(saved.ids as string[])];
					const ordered = ids.filter(id => id !== saved.active);
					if (typeof saved.active === 'string' && ids.includes(saved.active)) { ordered.push(saved.active); }
					await this.commands.executeCommand('shortestpath.draw.restoreTabs', ordered);
					while (this.pendingDrawingEditors.size) { await Promise.all([...this.pendingDrawingEditors]); }
				}
				this.drawingTabsRestored = true;
			} finally { this.restoringDrawingTabs = false; }
		}).catch(error => {
			this.drawingTabsReady = undefined;
			throw error;
		});
	}

	protected restoreMode(): void {
		const initialMode = this.storage.get(modeKey, StorageScope.PROFILE);
		const configured = this.configuration.getValue<boolean>('shortestpath.setup.completed');
		if (this.requestedMode !== undefined) {
			// An early navigation click takes precedence over the saved startup mode.
			this.applyMode('solve');
		} else if (isShortestPathPageMode(initialMode)) {
			this.applyMode('solve');
			void this.ready.then(() => this.switchMode(initialMode)).catch(onUnexpectedError);
		} else if (configured && initialMode !== 'solve') {
			this.applyMode('browse');
			void this.ensureBrowserTab().then(() => this.openHomeIfOnlyBlankTab()).catch(onUnexpectedError);
		} else { this.applyMode('solve'); }
	}

	private navigationModes(): ShortestPathMode[] {
		return this.browseButton.disabled ? ['solve', 'snippets', 'draw', 'dashboard', 'settings'] : ['browse', 'solve', 'snippets', 'draw', 'dashboard', 'settings'];
	}

	private switchNavigationPage(direction: -1 | 1): Promise<void> | void {
		const modes = this.navigationModes();
		const next = modes[modes.indexOf(this.requestedMode ?? this.mode) + direction];
		if (next) { return this.switchMode(next); }
	}

	private updateNavigationHints(): void {
		if (!this.previousPageButton || !this.nextPageButton) { return; }
		const modes = this.navigationModes();
		const index = modes.indexOf(this.requestedMode ?? this.mode);
		this.previousPageButton.disabled = index <= 0;
		this.nextPageButton.disabled = index >= modes.length - 1;
	}

	private button(parent: HTMLElement, label: string, run: () => PromiseLike<unknown> | void, icon?: string, store: DisposableStore = this._store): HTMLButtonElement {
		const button = append(parent, $('button', { type: 'button', 'aria-label': label })) as HTMLButtonElement;
		if ((parent === this.switcher || parent === this.navigationActions) && (icon === 'globe' || icon === 'code' || icon === 'snippets' || icon === 'pencil' || icon === 'dashboard' || icon === 'settings-gear')) {
			const svg = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
			svg.classList.add('shortestpath-mode-icon');
			svg.setAttribute('viewBox', '0 0 24 24');
			svg.setAttribute('aria-hidden', 'true');
			svg.setAttribute('focusable', 'false');
			const path = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
			path.setAttribute('d', icon === 'globe'
				? 'M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3ZM3 9h18M7 6.5h.01M10 6.5h.01'
				: icon === 'dashboard'
					? 'M4 4h6v6H4V4ZM14 4h6v6h-6V4ZM4 14h6v6H4v-6ZM14 14h6v6h-6v-6Z'
					: icon === 'snippets'
						? 'M8 3h11a2 2 0 0 1 2 2v12M5 7h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2ZM8 11l-3 3 3 3M13 11l3 3-3 3'
						: icon === 'pencil'
							? 'M4 20l4.5-1 12-12a2.1 2.1 0 0 0-3-3l-12 12L4 20ZM15.5 6.5l3 3M5.5 16.5l3 3M12 20h8'
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
		this.requestedMode = mode;
		await this.ready;
		if (this.stopped) { return; }
		if (mode === 'browse' && !this.configuration.getValue<boolean>('shortestpath.setup.completed')) { return; }
		if (mode === 'draw') {
			await this.restoreDrawingTabs();
			if (this.stopped || this.requestedMode !== mode) { return; }
		}
		this.applyMode(mode);
		if (mode === 'browse') {
			if (!this.activeBrowser) { await this.ensureBrowserTab(); }
			else { this.browserPart?.activeGroup.focus(); }
			this.openHomeIfOnlyBlankTab();
		} else if (isShortestPathPageMode(mode)) {
			try {
				if (!this.pages.has(mode)) {
					let pending = this.pendingPages.get(mode);
					if (!pending) {
						pending = this.commands.executeCommand<void>(shortestPathPageCommands[mode]);
						this.pendingPages.set(mode, pending);
						void pending.finally(() => this.pendingPages.delete(mode)).catch(onUnexpectedError);
					}
					await pending;
				}
				if (this.mode === mode) {
					const page = this.pages.get(mode);
					if (page) {
						this.showPage(page);
						if (mode === 'draw') { await this.sidebarTransition; }
						if (this.mode === mode) { if (mode === 'draw') { this.drawingPart?.activeGroup.focus(); } page.webview.focus(); }
					}
					else if (mode !== 'draw') { this.applyMode('solve'); }
				}
			} catch (error) {
				if (this.mode === mode) { this.applyMode('solve'); }
				throw error;
			}
		} else {
			this.resultBadge.hidden = true;
			// allow-any-unicode-next-line
			this.solveButton.setAttribute('aria-label', localize('sp.solve', "做题"));
			if (this.returnFocus?.isConnected) { this.returnFocus.focus(); }
			else { this.layoutService.focusPart(Parts.EDITOR_PART, mainWindow); }
		}
	}

	/** Reveal the owning surface before a foreground editor is opened there. */
	protected revealEditorMode(event: IEditorWillOpenEvent): void {
		if (this.drawingPart?.groups.some(group => group.id === event.groupId)) { this.drawingEditorOptions.set(event.editor, event.options ?? {}); }
		if (!shouldRevealSolveEditor(event)) { return; }
		if (this.drawingPart?.groups.some(group => group.id === event.groupId)) {
			if (event.editor instanceof WebviewInput && getShortestPathPageMode(event.editor.extension?.id.value, event.editor.webview.providedViewType) === 'draw') {
				if (this.mode !== 'draw') { this.applyMode('draw'); }
			} else { void this.switchMode('solve').catch(onUnexpectedError); }
		} else if (this.browserPart?.groups.some(group => group.id === event.groupId)) {
			if (this.mode !== 'browse') { this.applyMode('browse'); }
		} else if (this.mode !== 'solve' && this.editorGroups.mainPart.groups.some(group => group.id === event.groupId)) {
			void this.switchMode('solve').catch(onUnexpectedError);
		}
	}

	protected applyMode(mode: ShortestPathMode): void {
		if (mode === 'draw' && this.mode !== 'draw' && !this.drawingSidebar) {
			const active = this.paneComposites.getActivePaneComposite(ViewContainerLocation.Sidebar)?.getId();
			this.drawingSidebar = { id: active && active !== 'workbench.view.extension.shortestpath-draw' ? active : 'workbench.view.explorer', visible: this.layoutService.isVisible(Parts.SIDEBAR_PART) };
		}
		if (this.mode === 'solve' && mode !== 'solve') {
			const active = mainWindow.document.activeElement;
			this.returnFocus = active instanceof mainWindow.HTMLElement && !this.switcher.contains(active) && !this.navigationActions.contains(active) ? active : undefined;
		}
		this.mode = mode;
		this.requestedMode = mode;
		this.browsing.set(mode === 'browse');
		this.pageMode.set(isShortestPathPageMode(mode));
		this.drawing.set(mode === 'draw');
		this.layoutService.mainContainer.classList.toggle('shortestpath-browsing', mode === 'browse');
		this.layoutService.mainContainer.classList.toggle('shortestpath-page-mode', isShortestPathPageMode(mode));
		this.layoutService.mainContainer.classList.toggle('shortestpath-draw-mode', mode === 'draw');
		this.surface.hidden = mode !== 'browse';
		this.surface.inert = mode !== 'browse';
		this.browserPart?.setVisible(mode === 'browse');
		this.pageSurface.hidden = !isShortestPathPageMode(mode);
		this.drawingPart?.setVisible(mode === 'draw');
		// allow-any-unicode-next-line
		this.pageSurface.setAttribute('aria-label', mode === 'dashboard' ? dashboardLabel : mode === 'snippets' ? localize('sp.snippets', "代码片段") : mode === 'draw' ? drawLabel : localize('sp.settings', "设置"));
		this.browseButton.setAttribute('aria-pressed', String(mode === 'browse'));
		this.solveButton.setAttribute('aria-pressed', String(mode === 'solve'));
		this.snippetsButton.setAttribute('aria-pressed', String(mode === 'snippets'));
		this.drawButton.setAttribute('aria-pressed', String(mode === 'draw'));
		this.dashboardButton.setAttribute('aria-pressed', String(mode === 'dashboard'));
		this.settingsButton.setAttribute('aria-pressed', String(mode === 'settings'));
		this.updateNavigationHints();
		for (const [pageMode, input] of this.pages) {
			if (mode === pageMode) { this.showPage(input); }
			else if (pageMode !== 'draw') { input.webview.release(this); }
		}
		for (const part of [Parts.EDITOR_PART, Parts.SIDEBAR_PART, Parts.PANEL_PART, Parts.ACTIVITYBAR_PART, Parts.AUXILIARYBAR_PART, Parts.STATUSBAR_PART]) {
			const element = this.layoutService.getContainer(mainWindow, part);
			if (element) { element.inert = mode !== 'solve' && !(mode === 'draw' && (part === Parts.SIDEBAR_PART || part === Parts.ACTIVITYBAR_PART)); }
		}
		this.storage.store(modeKey, mode, StorageScope.PROFILE, StorageTarget.MACHINE);
		this.changeActive.fire();
		this.layout();
		if (mode === 'draw' || mode === 'solve') { void this.synchronizeDrawingSidebar(mode).catch(onUnexpectedError); }
	}

	/** Serialize native sidebar activation so a late open cannot override the current mode. */
	protected synchronizeDrawingSidebar(mode: ShortestPathMode): Promise<void> {
		const transition = this.sidebarTransition.then(async () => {
			if (this.stopped || this.mode !== mode) { return; }
			if (mode === 'draw') {
				await this.commands.executeCommand('shortestpath.draw.files.focus');
			} else if (mode === 'solve' && this.drawingSidebar) {
				const previous = this.drawingSidebar;
				await this.paneComposites.openPaneComposite(previous.id, ViewContainerLocation.Sidebar, false);
				if (this.mode === 'solve') {
					this.drawingSidebar = undefined;
					if (!previous.visible) { this.layoutService.setPartHidden(true, Parts.SIDEBAR_PART); }
				}
			}
		});
		this.sidebarTransition = transition.catch(onUnexpectedError);
		return transition;
	}

	private adoptPage(input: WebviewInput, preserveFocus: boolean): boolean {
		const mode = getShortestPathPageMode(input.extension?.id.value, input.webview.providedViewType);
		if (!mode) { return true; }
		if (mode === 'draw') {
			if (!this.drawingTabStores.has(input)) {
				const store = new DisposableStore();
				this.drawingTabStores.set(input, store);
				store.add(input.webview.onDidUpdateState(() => this.saveDrawingTabs()));
				store.add(input.onWillDispose(() => { this.drawingTabStores.deleteAndDispose(input); }));
			}
			const pending = this.pendingPages.has(mode);
			void this.ready.then(async () => {
				if (!this.restoringDrawingTabs) { await this.restoreDrawingTabs(); }
				if (this.stopped || input.isDisposed() || !this.drawingPart) { return; }
				if (!preserveFocus && (!pending || this.mode === mode)) { this.applyMode(mode); }
				const group = this.drawingPart.groups.find(group => group.contains(input)) ?? this.drawingPart.activeGroup;
				const opening = this.editors.openEditor(input, { pinned: true, preserveFocus: preserveFocus || this.mode !== 'draw' }, group);
				this.pendingDrawingEditors.add(opening);
				try { await opening; }
				finally { this.pendingDrawingEditors.delete(opening); }
				this.refreshDrawingTabs();
				this.drawingPart.setVisible(this.mode === 'draw');
			}).catch(onUnexpectedError);
			return false;
		}
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
		if (getShortestPathPageMode(input.extension?.id.value, input.webview.providedViewType) === 'draw') { return; }
		input.claim(this, mainWindow, undefined);
		input.webview.container.classList.add('shortestpath-page-webview');
		// The fixed page bounds already constrain the webview. A clipping root would
		// create a stacking context underneath the opaque page surface.
		input.webview.setAnchorElement(this.pageSurface);
	}

	async openBrowser(url = shortestPathHome, newTab = false, preserveFocus = false, options?: IEditorOptions & { group?: PreferredGroup }): Promise<BrowserEditorInput> {
		await this.ready;
		if (this.mode === 'solve') {
			const existing = !newTab ? this.editors.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).map(({ editor }) => editor).find((editor): editor is BrowserEditorInput => editor instanceof BrowserEditorInput && !this.ownsBrowserTab(editor) && editor.url === url) : undefined;
			const input = existing ?? await this.browsers.createBrowserView({ owner: { type: 'user' }, session: { scope: BrowserViewStorageScope.Global } });
			if (!existing && url.trim()) { input.navigate(url); }
			const { group: preferredGroup, ...editorOptions } = options ?? {};
			const group = existing && preferredGroup === undefined ? undefined : await this.browsers.getPreferredGroup(preferredGroup);
			await this.editors.openEditor(input, { pinned: true, ...editorOptions, preserveFocus }, group);
			return input;
		}
		let input = !newTab ? [...this.tabs.values()].find(tab => tab.url === url) : undefined;
		if (!input) {
			input = await this.browsers.createBrowserView({ owner: { type: 'user' }, session: { scope: BrowserViewStorageScope.Global } });
			if (url.trim()) { input.navigate(url); }
		}
		await this.showBrowser(input, preserveFocus);
		return input;
	}

	/** Opens browser-owned floating UI without allocating a browser until confirmation. */
	newBrowserTab(): void {
		if (this.newTabPicker.value) { this.newTabPicker.value.focus(); return; }
		const group = this.browserPart?.activeGroup;
		const originMode = this.mode;
		const originPane = originMode === 'browse' ? group?.activeEditorPane : this.editors.activeEditorPane;
		const open = (url: string) => {
			if (group && this.browserPart?.getGroup(group.id) === group) { this.browserPart.activateGroup(group); }
			void this.openBrowser(url, true).catch(onUnexpectedError);
		};
		const getEntries = (): BrowserNewTabEntry[] => {
			const tabs = this.tabEntries();
			const entries: BrowserNewTabEntry[] = (this.favorites?.values ?? []).map(url => {
				const key = group ? `${group.id}|favorite:${url}` : `favorite:${url}`;
				const input = this.findTab(key)?.input;
				return {
					id: `favorite:${url}`, title: input?.getName() ?? url, url, favicon: input?.favicon, favorite: true,
					run: () => { void this.selectTab(key).catch(onUnexpectedError); },
				};
			});
			entries.push(...tabs.map(entry => ({ id: entry.key, title: entry.input.getName(), url: entry.input.url ?? '', favicon: entry.input.favicon, favorite: false, run: () => { void this.selectTab(entry.key).catch(onUnexpectedError); } })));
			return entries;
		};
		const editor = getBrowserEditor(originPane) ?? getBrowserEditor(group?.activeEditorPane);
		const input = editor?.input;
		const providers = editor ? [...editor.getContributions()].flatMap(contribution => contribution.urlSuggestionProviders ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
		const primary = (text: string): BrowserNewTabEntry[] => {
			const engine = this.configuration.getValue<string>(BrowserSearchEngineSettingId);
			return getBrowserNavigationChoices(text, engine && engine !== 'none' ? engine as BrowserSearchEngineId : undefined).map(choice => ({
				id: `${choice.search}:${text}`, title: choice.label, url: choice.url, favorite: false, search: choice.search, run: () => open(choice.url),
			}));
		};
		this.newTabPicker.value = new ShortestPathBrowserNewTabOverlay(this.layoutService.mainContainer, getEntries(), text => primary(text)[0]?.run(), accepted => {
			this.newTabPicker.clear();
			if (!accepted && this.mode === originMode && originPane?.isVisible()) { originPane.focus(); }
		}, input && providers.length ? {
			onDidChange: Event.any(...providers.flatMap(provider => provider.onDidChange ? [provider.onDidChange] : [])),
			getEntries: async (text, token) => {
				const groups = await Promise.all(providers.map(async provider => {
					try { return { provider, suggestions: await provider.getSuggestions({ text, input }, token) }; }
					catch { return { provider, suggestions: [] }; }
				}));
				return [...getEntries(), ...groups.flatMap(({ provider, suggestions }) => suggestions.filter(suggestion => !suggestion.id.startsWith('favorite:') && !!suggestion.navigationUrl).map(suggestion => ({
					id: `${provider.label}:${suggestion.id}`, title: suggestion.label, url: suggestion.navigationUrl ?? suggestion.description ?? '',
					section: provider.label, favorite: false, navigate: !!suggestion.navigationUrl,
					favicon: suggestion.iconPath?.dark.toString(true),
					run: () => open(suggestion.navigationUrl!),
				})))];
			},
		} : undefined, primary);

	}

	ownsBrowserTab(input: BrowserEditorInput): boolean {
		return this.tabs.get(input.id) === input;
	}

	async showBrowser(input: BrowserEditorInput, preserveFocus = false): Promise<void> {
		await this.ready;
		if (this.stopped || input.isDisposed()) { return; }
		if (!this.tabs.has(input.id) && (this.mode === 'solve' || this.editors.isOpened(input))) {
			const group = this.editors.isOpened(input) ? undefined : await this.browsers.getPreferredGroup();
			await this.editors.openEditor(input, { preserveFocus, pinned: true }, group);
			return;
		}
		this.adopt(input);
		if (!this.configuration.getValue<boolean>('shortestpath.setup.completed')) { return; }
		if (!preserveFocus) {
			this.activeBrowser = input;
			this.applyMode('browse');
			await this.host.focus(mainWindow);
		}
		await this.openInBrowserPart(input, preserveFocus);
		this.changeActive.fire();
		this.layout();
		if (!preserveFocus && this.mode === 'browse' && this.activeBrowser === input) { this.browserPart?.activeGroup.focus(); }
	}

	/** Both surfaces use the same native editor groups and tab strip as Solve. */
	private createTabbedPart(container: HTMLElement): IEmbeddedEditorPart {
		const part = this._register(this.editorGroups.createEmbeddedEditorPart(container));
		this._register(part.enforcePartOptions({ showTabs: 'multiple', enablePreview: false, closeEmptyGroups: true, pinnedTabsOnSeparateRow: false, wrapTabs: false }));
		return part;
	}

	protected createDrawingPart(container: HTMLElement): void {
		const part = this.drawingPart = this.createTabbedPart(container);
		this._register(addDisposableListener(container, EventType.DBLCLICK, event => {
			if (this.mode === 'draw' && isHTMLElement(event.target) && event.target.classList.contains('tabs-container')) {
				EventHelper.stop(event, true);
				void this.commands.executeCommand('shortestpath.draw.newFile').catch(onUnexpectedError);
			}
		}, true));
		const track = (group: IEditorGroup) => {
			const store = new DisposableStore();
			this.drawingGroupStores.set(group.id, store);
			store.add(group.onDidModelChange(() => this.refreshDrawingTabs()));
			store.add(group.onDidActiveEditorChange(() => this.refreshDrawingTabs()));
			store.add(group.onDidCloseEditor(() => queueMicrotask(() => { if (!this.stopped) { this.refreshDrawingTabs(); } })));
		};
		part.groups.forEach(track);
		this._register(part.onDidAddGroup(track));
		this._register(part.onDidRemoveGroup(group => { this.drawingGroupStores.deleteAndDispose(group.id); this.refreshDrawingTabs(); }));
		this._register(part.onDidChangeActiveGroup(() => this.refreshDrawingTabs()));
		part.setVisible(false);
	}

	private refreshDrawingTabs(): void {
		const part = this.drawingPart;
		if (!part || this.stopped) { return; }
		const active = part.activeGroup.activeEditor;
		if (active instanceof WebviewInput && getShortestPathPageMode(active.extension?.id.value, active.webview.providedViewType) === 'draw') { this.pages.set('draw', active); }
		else { this.pages.delete('draw'); }
		for (const group of part.groups) {
			for (const input of group.editors) {
				if (input instanceof WebviewInput && getShortestPathPageMode(input.extension?.id.value, input.webview.providedViewType) === 'draw') { input.webview.container.classList.add('shortestpath-draw-webview'); }
				else {
					queueMicrotask(() => {
						if (!this.stopped && group.contains(input)) { group.moveEditor(input, this.editorGroups.mainPart.activeGroup, { ...(this.drawingEditorOptions.get(input) ?? { preserveFocus: true }), pinned: true }); }
					});
				}
			}
		}
		this.changeActive.fire();
		this.saveDrawingTabs();
	}

	private saveDrawingTabs(): void {
		if (!this.drawingPart || this.stopped || this.restoringDrawingTabs || !this.drawingTabsRestored) { return; }
		const id = (input: EditorInput | null | undefined): string | undefined => {
			if (!(input instanceof WebviewInput)) { return undefined; }
			try { const state = JSON.parse(input.webview.state ?? '{}') as { fileId?: unknown }; return typeof state.fileId === 'string' ? state.fileId : undefined; } catch { return undefined; }
		};
		const editors = this.drawingPart.getGroups(GroupsOrder.GRID_APPEARANCE).flatMap(group => group.editors);
		const ids = editors.map(id).filter((value): value is string => !!value);
		if (editors.length && ids.length !== editors.length) { return; }
		this.storage.store(drawingTabsKey, JSON.stringify({ ids: [...new Set(ids)], active: id(this.drawingPart.activeGroup.activeEditor) }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	protected createBrowserPart(container: HTMLElement): void {
		const part = this.browserPart = this.createTabbedPart(container);
		// Native editor tabs create an untitled file on an empty-strip double-click.
		// Route this gesture before that handler runs in the browsing surface.
		this._register(addDisposableListener(container, EventType.DBLCLICK, event => {
			if (this.mode !== 'browse' || !isHTMLElement(event.target) || !event.target.classList.contains('tabs-container')) {
				return;
			}
			EventHelper.stop(event, true);
			this.newBrowserTab();
		}, true));
		const track = (group: IEditorGroup) => {
			const store = new DisposableStore();
			this.browserGroupStores.set(group.id, store);
			store.add(group.onDidModelChange(() => this.renderTabs()));
			if (this.verticalTabs) { this.createVerticalBar(group); }
			store.add(group.onDidCloseEditor(() => queueMicrotask(() => { if (!this.stopped) { this.renderTabs(); } })));
		};
		part.groups.forEach(track);
		this._register(part.onDidAddGroup(track));
		this._register(part.onDidRemoveGroup(group => { this.browserGroupStores.deleteAndDispose(group.id); this.verticalBars.deleteAndDispose(group.id); this.renderTabs(); }));
		this._register(part.onDidChangeActiveGroup(() => this.renderTabs()));
		part.setVisible(false);
	}

	private async openInBrowserPart(input: BrowserEditorInput, preserveFocus: boolean, inactive = preserveFocus, index?: number): Promise<void> {
		const part = this.browserPart;
		if (!part || input.isDisposed()) { return; }
		this.openingTabs.add(input.id);
		this.adopt(input);
		const group = part.groups.find(group => group.contains(input)) ?? part.activeGroup;
		try {
			await this.editors.openEditor(input, { pinned: true, preserveFocus, inactive, index }, group);
		} finally {
			this.openingTabs.delete(input.id);
			part.setVisible(this.mode === 'browse');
			this.renderTabs();
		}
	}

	private adopt(input: BrowserEditorInput): void {
		if (input.isDisposed() || this.tabs.has(input.id)) { return; }
		this.tabs.set(input.id, input);
		const store = new DisposableStore();
		this.tabStores.set(input.id, store);
		store.add(input.onDidChangeLabel(() => { this.updateTabBar(); this.saveTabs(); }));
		store.add(input.onWillDispose(() => {
			this.tabs.delete(input.id);
			this.tabStores.deleteAndDispose(input.id);
			queueMicrotask(() => { if (!this.stopped) { this.renderTabs(); } });
		}));
	}

	protected renderTabs(): void {
		const part = this.browserPart;
		if (!part || this.stopped) { return; }
		const inputs = part.getGroups(GroupsOrder.GRID_APPEARANCE).flatMap(group => group.editors.filter((input): input is BrowserEditorInput => input instanceof BrowserEditorInput && !input.isDisposed()));
		inputs.forEach(input => this.adopt(input));
		for (const [id, input] of this.tabs) {
			if (!this.openingTabs.has(id) && !inputs.includes(input)) {
				this.tabs.delete(id);
				this.tabStores.deleteAndDispose(id);
			}
		}
		const active = part.activeGroup.activeEditor;
		this.activeBrowser = active instanceof BrowserEditorInput && !active.isDisposed() ? active : undefined;
		this.changeActive.fire();
		this.updateTabBar();
		this.refresh();
		this.saveTabs();
		void this.ensureBrowserTab().catch(onUnexpectedError);
	}


	private createTabBar(container: HTMLElement, group: IEditorGroup, vertical: boolean): IDisposable {
		const favoriteKey = (key: string) => key.startsWith('favorite:') ? `${group.id}|${key}` : key;
		const bar = new ShortestPathBrowserTabBar(container, {
			select: key => this.selectTab(favoriteKey(key)),
			editUrl: key => this.editTabUrl(favoriteKey(key)),
			close: key => this.closeTab(favoriteKey(key)),
			move: (key, target) => this.moveTab(key, target),
			create: () => { this.browserPart?.activateGroup(group); this.newBrowserTab(); },
			setVertical: value => this.setVerticalTabs(value),
			getMenu: key => this.tabMenu(favoriteKey(key)),
		}, this.hover, this.contextMenu);
		bar.setVertical(vertical);
		bar.element.classList.toggle('native-leading', !vertical);
		this.groupTabBars.set(group.id, bar);
		this.updateTabBar();
		return toDisposable(() => {
			if (this.groupTabBars.get(group.id) === bar) { this.groupTabBars.delete(group.id); }
			bar.dispose();
			bar.element.remove();
		});
	}

	private createVerticalBar(group: IEditorGroup): void {
		const sidebar = this.browserPart!.createGroupSidebar(group, 200);
		if (!isHTMLElement(sidebar.container)) { sidebar.dispose(); return; }
		const store = new DisposableStore();
		store.add(sidebar);
		store.add(this.createTabBar(sidebar.container, group, true));
		this.verticalBars.set(group.id, store);
	}

	private setVerticalTabs(vertical: boolean): void {
		const part = this.browserPart;
		if (!part) { return; }
		this.verticalTabs = vertical;
		this.verticalBars.clearAndDisposeAll();
		this.browserTabOptions.value = part.enforcePartOptions({
			showTabs: vertical ? 'none' : 'multiple',
			isTabVisible: (input: EditorInput, groupId: number) => !(input instanceof BrowserEditorInput && this.favorites?.values.some(url => this.findTab(`${groupId}|favorite:${url}`)?.input === input)),
			onDidChangeTabVisibility: this.changeTabVisibility.event,
			createTabsLeading: (container: unknown, groupId: number) => {
				const store = new DisposableStore();
				// A newly constructed group is registered after its title control is created.
				queueMicrotask(() => {
					const group = part.getGroup(groupId);
					if (!store.isDisposed && group && isHTMLElement(container)) {
						store.add(this.createTabBar(container, group, false));
						this.refresh();
					}
				});
				return store;
			},
			onActiveTabClick: (input: EditorInput, groupId: number) => { if (input instanceof BrowserEditorInput) { this.editTabUrl(`${groupId}:${input.id}`); } },
		});
		if (vertical) { part.groups.forEach(group => this.createVerticalBar(group)); }
		this.storage.store(verticalTabsKey, vertical, StorageScope.PROFILE, StorageTarget.MACHINE);
		this.refresh();
	}

	private tabEntries(): { key: string; group: IEditorGroup; input: BrowserEditorInput }[] {
		return this.browserPart?.getGroups(GroupsOrder.GRID_APPEARANCE).flatMap(group => group.editors
			.filter((input): input is BrowserEditorInput => input instanceof BrowserEditorInput && !input.isDisposed())
			.map(input => ({ key: `${group.id}:${input.id}`, group, input }))) ?? [];
	}

	private findTab(key: string): { group: IEditorGroup; input: BrowserEditorInput } | undefined {
		const separator = key.indexOf('|favorite:');
		const groupId = separator >= 0 ? Number(key.slice(0, separator)) : undefined;
		if (separator >= 0) { key = key.slice(separator + 1); }
		const entries = this.tabEntries().filter(entry => groupId === undefined || entry.group.id === groupId);
		if (key.startsWith('favorite:')) {
			const url = key.slice('favorite:'.length);
			const favoriteKey = groupId === undefined ? undefined : `${groupId}|${key}`;
			const linked = favoriteKey ? this.favoriteTabs.get(favoriteKey) : undefined;
			const linkedEntry = linked ? entries.find(entry => entry.input === linked) : undefined;
			if (linkedEntry && this.favorites?.isFavorite(url)) { return linkedEntry; }
			const candidates = entries.filter(entry => ![...this.favoriteTabs].some(([binding, input]) => input === entry.input && binding !== favoriteKey && binding.startsWith(`${entry.group.id}|`)));
			return candidates.find(entry => (groupId === undefined ? entry.input === this.activeBrowser : entry.group.activeEditor === entry.input) && entry.input.url === url)
				?? candidates.find(entry => entry.input.url === url);
		}
		return entries.find(entry => entry.key === key);
	}

	private async selectTab(key: string): Promise<void> {
		const entry = this.findTab(key);
		if (entry) {
			await this.editors.openEditor(entry.input, { pinned: true }, entry.group);
			this.browserPart?.activateGroup(entry.group);
			this.renderTabs();
		} else if (key.includes('favorite:')) {
			const separator = key.indexOf('|favorite:');
			if (separator >= 0) { this.browserPart?.activateGroup(Number(key.slice(0, separator))); }
			await this.openBrowser(key.slice(key.indexOf('favorite:') + 'favorite:'.length), true);
		}
	}

	private editTabUrl(key: string): void {
		const entry = this.findTab(key);
		const editor = getBrowserEditor(entry?.group.activeEditorPane);
		if (editor && editor.input === entry?.input) {
			editor.getContribution(BrowserNavigationFeatures)?.openUrlPicker();
		}
	}

	private closeTab(key: string): void {
		const entry = this.findTab(key);
		if (entry) { void entry.group.closeEditor(entry.input).catch(onUnexpectedError); }
	}

	private moveTab(key: string, targetKey: string): void {
		const source = this.findTab(key);
		const target = this.findTab(targetKey);
		if (!source || !target || source.group !== target.group || source.group.isSticky(source.input) !== target.group.isSticky(target.input)) { return; }
		source.group.moveEditor(source.input, source.group, { index: source.group.getIndexOfEditor(target.input) });
	}

	private tabMenu(key: string): IAction[] {
		const entry = this.findTab(key);
		const url = key.includes('favorite:') ? key.slice(key.indexOf('favorite:') + 'favorite:'.length) : entry?.input.url;
		const action = (id: string, label: string, run: () => void | Promise<void>): IAction => ({ id, label, enabled: true, checked: false, tooltip: label, class: undefined, run: async () => run() });
		const actions: IAction[] = [];
		if (url) {
			const favorited = !!this.favorites?.isFavorite(url);
			actions.push(action('favorite', favorited ? browserTabBarLabels.removeFavorite : browserTabBarLabels.addFavorite, () => this.favorites?.toggle(url)));
		}
		if (entry) {
			const entries = this.tabEntries().filter(tab => tab.group === entry.group);
			const index = entries.findIndex(tab => tab.input === entry.input);
			if (index > 0) { actions.push(action('previous', browserTabBarLabels.previous, () => this.moveTab(key, entries[index - 1].key))); }
			if (index < entries.length - 1) { actions.push(action('next', browserTabBarLabels.next, () => this.moveTab(key, entries[index + 1].key))); }
			actions.push(action('close', browserTabBarLabels.close, () => this.closeTab(key)));
			actions.push(action('splitRight', browserTabBarLabels.splitRight, async () => {
				await this.selectTab(key);
				await this.commands.executeCommand('workbench.action.splitEditorRight', { groupId: entry.group.id });
			}));
			actions.push(action('splitDown', browserTabBarLabels.splitDown, async () => {
				await this.selectTab(key);
				await this.commands.executeCommand('workbench.action.splitEditorDown', { groupId: entry.group.id });
			}));
		}
		return actions;
	}

	private updateTabBar(): void {
		if (!this.groupTabBars.size) { return; }
		const entries = this.tabEntries();
		const favoriteUrls = this.favorites?.values ?? [];
		for (const [key, input] of this.favoriteTabs) {
			if (!entries.some(entry => entry.input === input && key.startsWith(`${entry.group.id}|`)) || !favoriteUrls.includes(key.slice(key.indexOf('|favorite:') + '|favorite:'.length))) { this.favoriteTabs.delete(key); }
		}
		const item = (key: string, input: BrowserEditorInput, group: IEditorGroup): BrowserTabBarItem => ({
			key, title: input.title || input.url || browserTabBarLabels.new, url: input.url ?? '', favicon: input.favicon,
			active: group.activeEditor === input, loading: input.model?.loading,

		});
		for (const [groupId, bar] of this.groupTabBars) {
			const group = this.browserPart?.getGroup(groupId);
			if (!group) { continue; }
			const favorites = favoriteUrls.map(url => {
				const key = `favorite:${url}`;
				const entry = this.findTab(`${groupId}|${key}`);
				if (entry) {
					this.favoriteTabs.set(`${groupId}|${key}`, entry.input);
					return { ...item(key, entry.input, entry.group), opened: true };
				}
				const model = entries.find(entry => entry.input.model)?.input.model;
				const history = model?.history.entries.items.findLast(entry => entry.url === url);
				return { key, title: history?.title || URL.parse(url)?.hostname || url, url, favicon: history?.icon ? model?.history.favicons.get(history.icon) : undefined, active: false };
			});
			bar.update(this.verticalTabs ? entries.filter(entry => entry.group === group).map(entry => item(entry.key, entry.input, group)) : [], favorites);
		}
		this.changeTabVisibility.fire();
	}

	private openHomeIfOnlyBlankTab(): void {
		if (this.stopped || this.mode !== 'browse') { return; }
		const inputs = this.browserPart?.groups.flatMap(group => group.editors) ?? [];
		if (inputs.length === 1 && inputs[0] instanceof BrowserEditorInput && !inputs[0].isDisposed() && !inputs[0].url?.trim()) {
			inputs[0].navigate(shortestPathHome);
		}
	}

	/** Keep a blank native browser tab available while the browsing surface is active. */
	protected ensureBrowserTab(): Promise<void> {
		if (this.emptyTabPromise) { return this.emptyTabPromise; }
		if (this.stopped || this.mode !== 'browse' || !this.configuration.getValue<boolean>('shortestpath.setup.completed') || this.openingTabs.size || this.browserPart?.groups.some(group => group.count > 0)) {
			return Promise.resolve();
		}
		this.emptyTabPromise = this.ready.then(async () => {
			if (this.stopped || this.mode !== 'browse' || this.openingTabs.size || this.browserPart?.groups.some(group => group.count > 0)) { return; }
			const input = await this.browsers.createBrowserView({ owner: { type: 'user' }, session: { scope: BrowserViewStorageScope.Global } });
			if (this.stopped || this.mode !== 'browse' || this.openingTabs.size || this.browserPart?.groups.some(group => group.count > 0)) { input.dispose(true); return; }
			await this.openInBrowserPart(input, true);
			if (!this.stopped && this.mode === 'browse') { this.browserPart?.activeGroup.focus(); }
		}).finally(() => { this.emptyTabPromise = undefined; });
		return this.emptyTabPromise;
	}

	protected registerLayoutListeners(): void {
		this._register(this.layoutService.onDidLayoutMainContainer(() => this.layout()));
		this._register(this.layoutService.onDidChangePartVisibility(() => this.layout()));
		// Sash drags resize the editor without resizing the workbench container.
		this._register(this.editorGroups.mainPart.onDidLayout(() => this.layout()));
		this._register(onDidChangeZoomLevel(() => this.layout()));
	}

	private layout(): void {
		if (!this.surface) { return; }
		const navigation = (this.layoutService.mainWindowNavigationLayoutContainer ?? this.layoutService.mainWindowNavigationContainer)!.getBoundingClientRect();
		const root = this.layoutService.mainContainer.getBoundingClientRect();
		// Navigation can have transient collapsed bounds during workbench layout.
		// Keep independent pages below the visible title bar and banner instead.
		this.surface.style.top = `${this.layoutService.mainContainerOffset.top}px`;
		this.surface.style.left = `${navigation.right - root.left}px`;
		this.pageSurface.style.top = this.surface.style.top;
		const editorContainer = this.layoutService.getContainer(mainWindow, Parts.EDITOR_PART);
		const editor = editorContainer?.getBoundingClientRect();
		this.pageSurface.style.left = this.mode === 'draw' && editor ? `${editor.left - root.left}px` : this.surface.style.left;
		this.pageSurface.style.right = this.mode === 'draw' && editor ? `${root.right - editor.right}px` : '';
		if (this.mode === 'draw') {
			const drawingContainer = this.drawingSurface;
			if (editorContainer) { this.pageSurface.style.borderRadius = mainWindow.getComputedStyle(editorContainer).borderRadius; }
			const bounds = this.pageSurface.getBoundingClientRect();
			this.drawingPart?.layout(bounds.width, bounds.height, bounds.top, bounds.left);
			// Embedded layout clears its floating edges, so apply the shared perimeter afterwards.
			if (editorContainer && drawingContainer) {
				for (const edge of ['left', 'right', 'top', 'bottom']) {
					drawingContainer.classList.toggle(`floating-editor-outer-${edge}`, editorContainer.classList.contains(`floating-editor-outer-${edge}`));
				}
			}
		} else { this.pageSurface.style.borderRadius = ''; }
		this.refresh();
	}

	protected refresh(): void {
		if (!this.surface || this.stopped) { return; }
		if (this.mode === 'browse') {
			const bounds = (this.browserHost ?? this.surface).getBoundingClientRect();
			this.browserPart?.layout(bounds.width, bounds.height, bounds.top, bounds.left);
		}
	}

	private saveTabs(): void {
		if (this.stopped || this.restoringBrowserTabs) { return; }
		const ordered = this.browserPart?.getGroups(GroupsOrder.GRID_APPEARANCE).flatMap(group => group.editors.filter((input): input is BrowserEditorInput => input instanceof BrowserEditorInput)) ?? [...this.tabs.values()];
		const saved = ordered.filter(tab => isRestorableBrowserUrl(tab.url ?? ''));
		this.storage.store(tabsKey, JSON.stringify({ urls: saved.map(tab => tab.url), ids: saved.map(tab => tab.id), active: Math.max(0, saved.indexOf(this.activeBrowser!)) }), StorageScope.PROFILE, StorageTarget.MACHINE);
	}

	notifyResult(): void {
		if (this.mode === 'browse') {
			this.resultBadge.hidden = false;
			// allow-any-unicode-next-line
			this.solveButton.setAttribute('aria-label', localize('sp.newResult', "做题，有新的评测结果"));
		}
	}

	focusAddress(): void { void this.commands.executeCommand(BrowserViewCommandId.FocusUrlInput).catch(onUnexpectedError); }
	closeActiveTab(): void { if (this.activeBrowser) { void this.browserPart?.activeGroup.closeEditor(this.activeBrowser).catch(onUnexpectedError); } }

	override dispose(): void {
		this.saveTabs();
		this.stopped = true;
		this.browserPart?.setVisible(false);
		for (const [mode, input] of this.pages) { if (mode !== 'draw') { input.dispose(); } }
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
registerWorkbenchContribution2(ShortestPathModeContribution.ID, ShortestPathModeContribution, WorkbenchPhase.BlockRestore);

const modeTitles = {
	dashboard: { ...localize2('sp.switchDashboard', "Open Dashboard"), value: dashboardLabel },
	// allow-any-unicode-next-line
	browse: localize2('sp.switchBrowse', "切换到浏览模式"),
	// allow-any-unicode-next-line
	solve: localize2('sp.switchSolve', "切换到做题模式"),
	// allow-any-unicode-next-line
	snippets: localize2('sp.switchSnippets', "打开代码片段"),
	draw: drawTitle,
	// allow-any-unicode-next-line
	settings: localize2('sp.switchSettings', "打开设置"),
};
for (const mode of ['browse', 'solve', 'snippets', 'draw', 'settings', 'dashboard'] as const) {
	registerAction2(class extends Action2 {
		constructor() { super({ id: `shortestpath.mode.${mode}`, title: modeTitles[mode], f1: true }); }
		run(accessor: ServicesAccessor): Promise<void> { return accessor.get(IShortestPathModeService).switchMode(mode); }
	});
}
registerAction2(class extends Action2 {
	// allow-any-unicode-next-line
	constructor() { super({ id: 'shortestpath.mode.toggle', title: localize2('sp.toggleMode', "切换浏览 / 做题模式"), f1: true, keybinding: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Space, weight: KeybindingWeight.WorkbenchContrib } }); }
	run(accessor: ServicesAccessor): Promise<void> { const service = accessor.get(IShortestPathModeService); return service.switchMode(service.mode === 'browse' ? 'solve' : 'browse'); }
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'shortestpath.page.back',
			// allow-any-unicode-next-line
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
	// allow-any-unicode-next-line
	['address', localize2('sp.focusAddress', "浏览：聚焦地址栏"), KeyMod.CtrlCmd | KeyCode.KeyL, (service: ShortestPathModeService) => service.focusAddress()],
	// allow-any-unicode-next-line
	['newTab', localize2('sp.openTab', "浏览：新建标签页"), KeyMod.CtrlCmd | KeyCode.KeyT, (service: ShortestPathModeService) => service.newBrowserTab()],
	// allow-any-unicode-next-line
	['closeTab', localize2('sp.closeActive', "浏览：关闭标签页"), KeyMod.CtrlCmd | KeyCode.KeyW, (service: ShortestPathModeService) => service.closeActiveTab()],
] as const) {
	registerAction2(class extends Action2 {
		constructor() { super({ id: `shortestpath.browser.${id}`, title, f1: true, precondition: browsingContext, keybinding: { primary, when: browsingContext, weight: KeybindingWeight.WorkbenchContrib + 1 } }); }
		run(accessor: ServicesAccessor) { return run(accessor.get(IShortestPathModeService) as ShortestPathModeService); }
	});
}
