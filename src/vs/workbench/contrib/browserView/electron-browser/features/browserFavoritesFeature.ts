/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../../nls.js';
import { $ } from '../../../../../base/browser/dom.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { HoverPosition } from '../../../../../base/browser/ui/hover/hoverWidget.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { WorkbenchHoverDelegate } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { QuickInputButtonLocation } from '../../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { BrowserViewCommandId } from '../../../../../platform/browserView/common/browserView.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IBrowserViewModel } from '../../common/browserView.js';
import {
	BROWSER_EDITOR_ACTIVE,
	BrowserActionCategory,
	BrowserActionGroup,
	BrowserEditor,
	BrowserEditorContribution,
	BrowserWidgetLocation,
	CONTEXT_BROWSER_HAS_URL,
	IBrowserEditorWidget,
	IBrowserUrlPickerAction,
	IBrowserUrlPickerActionProvider,
	IBrowserUrlSuggestion,
	IBrowserUrlSuggestionAction,
	IBrowserUrlSuggestionProvider,
} from '../browserEditor.js';

const CONTEXT_BROWSER_URL_IS_FAVORITED = new RawContextKey<boolean>('browserUrlIsFavorited', false, localize('browser.urlIsFavorited', "Whether the current browser URL is a favorite"));

/**
 * Clickable star indicator shown in the URL bar's PostUrl slot when the
 * current page is a favorite. Clicking it removes the favorite.
 */
class FavoriteIndicator extends Disposable {
	readonly element: HTMLElement;
	private readonly _button: Button;
	private readonly _onDidClick = this._register(new Emitter<void>());
	readonly onDidClick = this._onDidClick.event;

	constructor(
		instantiationService: IInstantiationService,
		private readonly _keybindingService: IKeybindingService,
	) {
		super();
		const hoverDelegate = this._register(instantiationService.createInstance(
			WorkbenchHoverDelegate,
			'element',
			undefined,
			{ position: { hoverPosition: HoverPosition.ABOVE } }
		));

		this.element = $('.browser-favorite-indicator-container');
		this.element.style.display = 'none';
		this._button = this._register(new Button(this.element, {
			supportIcons: true,
			title: this._tooltip(),
			small: true,
			hoverDelegate
		}));
		this._button.element.classList.add('browser-favorite-indicator');
		this._button.label = `$(${Codicon.starFull.id})`;
		this._button.element.setAttribute('aria-label', localize('browser.removeFavorite', "Remove from Favorites"));
		this._register(this._button.onDidClick(() => this._onDidClick.fire()));
		this._register(this._keybindingService.onDidUpdateKeybindings(() => {
			this._button.setTitle(this._tooltip());
		}));
	}

	private _tooltip(): string {
		const kb = this._keybindingService.lookupKeybinding(BrowserViewCommandId.ToggleFavorite)?.getLabel();
		return kb
			? localize('browser.removeFavoriteWithKb', "Remove from Favorites ({0})", kb)
			: localize('browser.removeFavorite', "Remove from Favorites");
	}

	setVisible(visible: boolean): void {
		this.element.style.display = visible ? '' : 'none';
	}
}

/** Shared API for the existing workspace favorites, including external storage updates. */
export class BrowserFavoritesStore extends Disposable {
	private static readonly STORAGE_KEY = 'workbench.browser.favorites';
	private static readonly DETAILS_KEY = 'workbench.browser.favoriteDetails';
	private static readonly LAYOUT_KEY = 'workbench.browser.favoriteLayout';
	private readonly change = this._register(new Emitter<void>());
	readonly onDidChange = this.change.event;
	private urls = new Set<string>();

	constructor(private readonly _storageService: IStorageService) {
		super();
		if (_storageService.get(BrowserFavoritesStore.STORAGE_KEY, StorageScope.WORKSPACE) === undefined) {
			_storageService.store(BrowserFavoritesStore.STORAGE_KEY, JSON.stringify(['https://shortestpath.cn/']), StorageScope.WORKSPACE, StorageTarget.USER);
		}
		this.load();
		for (const key of [BrowserFavoritesStore.DETAILS_KEY, BrowserFavoritesStore.LAYOUT_KEY]) {
			this._register(_storageService.onDidChangeValue(StorageScope.WORKSPACE, key, this._store)(() => this.change.fire()));
		}
		const listeners = this._register(new DisposableStore());
		this._register(_storageService.onDidChangeValue(StorageScope.WORKSPACE, BrowserFavoritesStore.STORAGE_KEY, listeners)(() => {
			this.load();
			this.change.fire();
		}));
	}

	get entries(): readonly { url: string; title?: string; favicon?: string; name?: string }[] {
		const details = this.details();
		return this.values.map(url => ({ url, ...details[url] }));
	}

	get compact(): boolean { return this._storageService.getBoolean(BrowserFavoritesStore.LAYOUT_KEY, StorageScope.WORKSPACE, false); }

	setCompact(compact: boolean): void {
		this._storageService.store(BrowserFavoritesStore.LAYOUT_KEY, compact, StorageScope.WORKSPACE, StorageTarget.USER);
		this.change.fire();
	}

	private details(): Record<string, { title?: string; favicon?: string; name?: string }> {
		try {
			const value: unknown = JSON.parse(this._storageService.get(BrowserFavoritesStore.DETAILS_KEY, StorageScope.WORKSPACE, '{}'));
			if (!value || typeof value !== 'object' || Array.isArray(value)) { return {}; }
			return Object.fromEntries(Object.entries(value).filter(([, item]) => !!item && typeof item === 'object').map(([url, item]) => {
				const data = item as { title?: string; favicon?: string; name?: string };
				return [url, { title: typeof data.title === 'string' ? data.title : undefined, favicon: typeof data.favicon === 'string' ? data.favicon : undefined, name: typeof data.name === 'string' ? data.name : undefined }];
			}));
		} catch { return {}; }
	}

	rename(url: string, name: string): void {
		if (!this.isFavorite(url)) { return; }
		const details = this.details();
		details[url] = { ...details[url], name: name.trim() || undefined };
		this.saveDetails(details);
	}

	updateMetadata(url: string, title?: string, favicon?: string): void {
		if (!this.isFavorite(url)) { return; }
		const details = this.details();
		const previous = details[url];
		const next = { ...previous, title: title && title !== url ? title : previous?.title, favicon: favicon || previous?.favicon };
		if (next.title === previous?.title && next.favicon === previous?.favicon) { return; }
		details[url] = next;
		this.saveDetails(details);
	}

	private saveDetails(details: Record<string, { title?: string; favicon?: string; name?: string }>): void {
		this._storageService.store(BrowserFavoritesStore.DETAILS_KEY, JSON.stringify(details), StorageScope.WORKSPACE, StorageTarget.USER);
		this.change.fire();
	}

	move(url: string, target: string): void {
		if (url === target || !this.isFavorite(url) || !this.isFavorite(target)) { return; }
		const values = this.values.filter(value => value !== url);
		values.splice(values.indexOf(target), 0, url);
		this.urls = new Set(values);
		this._storageService.store(BrowserFavoritesStore.STORAGE_KEY, JSON.stringify(values), StorageScope.WORKSPACE, StorageTarget.USER);
		this.change.fire();
	}

	get values(): readonly string[] { return [...this.urls]; }
	isFavorite(url: string): boolean { return this.urls.has(url); }

	private load(): void {
		const raw = this._storageService.get(BrowserFavoritesStore.STORAGE_KEY, StorageScope.WORKSPACE);
		if (!raw) {
			this.urls = new Set();
			return;
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			this.urls = new Set(
				Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : []
			);
		} catch {
			this.urls = new Set();
		}
	}

	toggle(url: string): void {
		if (this.urls.has(url)) {
			this.urls.delete(url);
		} else {
			this.urls.add(url);
		}
		this._storageService.store(
			BrowserFavoritesStore.STORAGE_KEY,
			JSON.stringify([...this.urls]),
			StorageScope.WORKSPACE,
			StorageTarget.USER,
		);
		this.change.fire();
	}

	// Idempotent: callers that should never re-add a favorite (e.g. the per-item
	// delete button on suggestions) must use this rather than `toggle`.
	remove(url: string): void {
		if (!this.urls.has(url)) {
			return;
		}
		this.urls.delete(url);
		this._storageService.store(
			BrowserFavoritesStore.STORAGE_KEY,
			JSON.stringify([...this.urls]),
			StorageScope.WORKSPACE,
			StorageTarget.USER,
		);
		this.change.fire();
	}
}

/**
 * Workspace-scoped favorites: persists a set of favorite URLs and surfaces
 * them as URL bar suggestions plus a toggle button in the picker chrome.
 *
 * Page metadata and user names are stored separately to preserve the existing URL API.
 */
export class BrowserFavoritesFeature extends BrowserEditorContribution {

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	private readonly favorites: BrowserFavoritesStore;

	private readonly _suggestionProvider: IBrowserUrlSuggestionProvider;
	private readonly _actionProvider: IBrowserUrlPickerActionProvider;
	private readonly _indicator: FavoriteIndicator;
	private readonly _isFavoriteContext: IContextKey<boolean>;

	constructor(
		editor: BrowserEditor,
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
	) {
		super(editor);
		this.favorites = this._register(new BrowserFavoritesStore(storageService));
		this._isFavoriteContext = CONTEXT_BROWSER_URL_IS_FAVORITED.bindTo(contextKeyService);

		this._indicator = this._register(new FavoriteIndicator(instantiationService, this._keybindingService));
		this._register(this._indicator.onDidClick(() => this.toggleCurrent()));

		this._register(this.favorites.onDidChange(() => {
			this._refresh();
			this._onDidChangeState.fire();
		}));

		this._suggestionProvider = {
			label: localize('browser.favorites', "Favorites"),
			order: 50,
			actions: [],
			onDidChange: this._onDidChangeState.event,
			getSuggestions: async ({ input }) => {
				const suggestions: IBrowserUrlSuggestion[] = [];
				const current = input.url;
				for (const url of this.favorites.values) {
					if (url === current) {
						continue;
					}
					const deleteAction: IBrowserUrlSuggestionAction = {
						id: 'browser.favorites.delete',
						iconClass: ThemeIcon.asClassName(Codicon.trash),
						tooltip: localize('browser.removeFavorite', "Remove from Favorites"),
						run: () => this.favorites.remove(url),
					};
					suggestions.push({
						id: 'favorite:' + url,
						navigationUrl: url,
						label: url,
						icon: Codicon.star,
						apply: target => target.navigate(url),
						actions: [deleteAction],
					});
				}
				return suggestions;
			},
		};

		this._actionProvider = {
			onDidChange: this._onDidChangeState.event,
			getActions: input => {
				const url = input.url;
				if (!url) {
					return [];
				}
				const favorite = this.favorites.isFavorite(url);
				const tooltip = favorite
					? localize('browser.removeFavorite', "Remove from Favorites")
					: localize('browser.addFavorite', "Add to Favorites");
				const action: IBrowserUrlPickerAction = {
					id: 'browser.toggleFavorite',
					iconClass: ThemeIcon.asClassName(favorite ? Codicon.starFull : Codicon.star),
					tooltip,
					alwaysVisible: true,
					toggle: { checked: favorite },
					location: QuickInputButtonLocation.Input,
					run: target => {
						const u = target.url;
						if (u) {
							this.favorites.toggle(u);
						}
					},
				};
				return [action];
			},
		};
	}

	override get widgets(): readonly IBrowserEditorWidget[] {
		return [{ location: BrowserWidgetLocation.PostUrl, element: this._indicator.element, order: 60 }];
	}

	override get urlSuggestionProviders(): readonly IBrowserUrlSuggestionProvider[] {
		return [this._suggestionProvider];
	}

	override get urlPickerActionProviders(): readonly IBrowserUrlPickerActionProvider[] {
		return [this._actionProvider];
	}

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		// Button visuals, indicator visibility, and context key depend on input.url.
		store.add(model.onDidNavigate(() => {
			this._refresh();
			this._onDidChangeState.fire();
		}));
		store.add(model.onDidChangeTitle(() => this._refresh()));
		store.add(model.onDidChangeFavicon(() => this._refresh()));
		this._refresh();
	}

	override onModelDetached(): void {
		this._isFavoriteContext.reset();
		this._indicator.setVisible(false);
	}

	isFavorite(url: string): boolean {
		return this.favorites.isFavorite(url);
	}

	toggleCurrent(): void {
		const url = this.editor.model?.url;
		if (url) {
			this.favorites.toggle(url);
		}
	}

	private _refresh(): void {
		const url = this.editor.model?.url ?? '';
		const favorite = !!url && this.favorites.isFavorite(url);
		this._isFavoriteContext.set(favorite);
		this._indicator.setVisible(favorite);
		if (favorite) { this.favorites.updateMetadata(url, this.editor.model?.title, this.editor.model?.favicon); }
	}


}

BrowserEditor.registerContribution(BrowserFavoritesFeature);

// -- Actions ----------------------------------------------------------

class ToggleFavoriteAction extends Action2 {
	static readonly ID = BrowserViewCommandId.ToggleFavorite;

	constructor() {
		super({
			id: ToggleFavoriteAction.ID,
			title: localize2('browser.addFavoriteAction', 'Add to Favorites'),
			category: BrowserActionCategory,
			icon: Codicon.star,
			f1: true,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL),
			toggled: {
				condition: CONTEXT_BROWSER_URL_IS_FAVORITED,
				icon: Codicon.starFull,
			},
			menu: {
				id: MenuId.BrowserActionsToolbar,
				group: BrowserActionGroup.Data,
				order: 2,
				isHiddenByDefault: true,
			},
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, CONTEXT_BROWSER_HAS_URL),
				primary: KeyMod.CtrlCmd | KeyCode.KeyD,
			}
		});
	}

	async run(accessor: ServicesAccessor, browserEditor = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		if (browserEditor instanceof BrowserEditor) {
			browserEditor.getContribution(BrowserFavoritesFeature)?.toggleCurrent();
		}
	}
}

registerAction2(ToggleFavoriteAction);
