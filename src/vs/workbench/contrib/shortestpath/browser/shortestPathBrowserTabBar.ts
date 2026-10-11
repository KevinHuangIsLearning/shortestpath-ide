/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/shortestPathBrowserTabBar.css';
import { $, addDisposableListener, append, EventType, isHTMLElement } from '../../../../base/browser/dom.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { IAction } from '../../../../base/common/actions.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { getNLSLanguage, localize } from '../../../../nls.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';

const chinese = getNLSLanguage()?.toLowerCase().startsWith('zh');

/** Labels shared by the strip and its native menus. Site metadata stays untranslated. */
export const browserTabBarLabels = {
	// allow-any-unicode-next-line
	dismiss: chinese ? '关闭浮动输入' : localize('sp.tabs.dismiss', "Dismiss New Tab"),
	// allow-any-unicode-next-line
	open: chinese ? '打开网页' : localize('sp.tabs.open', "Open Page"),
	// allow-any-unicode-next-line
	search: chinese ? '搜索或输入网址…' : localize('sp.tabs.search', "Search or Enter URL…"),
	// allow-any-unicode-next-line
	switchTab: chinese ? '切换到标签页' : localize('sp.tabs.switchTab', "Switch to Tab"),
	// allow-any-unicode-next-line
	vertical: chinese ? '垂直标签页' : localize('sp.tabs.vertical', "Vertical Tabs"),
	// allow-any-unicode-next-line
	horizontal: chinese ? '横向标签页' : localize('sp.tabs.horizontal', "Horizontal Tabs"),
	// allow-any-unicode-next-line
	favorites: chinese ? '收藏夹' : localize('sp.tabs.favorites', "Favorites"),
	// allow-any-unicode-next-line
	collapseFavorites: chinese ? '收起收藏夹' : localize('sp.tabs.collapseFavorites', "Collapse Favorites"),
	// allow-any-unicode-next-line
	expandFavorites: chinese ? '展开收藏夹' : localize('sp.tabs.expandFavorites', "Expand Favorites"),
	// allow-any-unicode-next-line
	tabs: chinese ? '浏览器标签页' : localize('sp.tabs.tabs', "Browser Tabs"),
	// allow-any-unicode-next-line
	new: chinese ? '新建标签页' : localize('sp.tabs.new', "New Tab"),
	// allow-any-unicode-next-line
	more: chinese ? '标签页操作' : localize('sp.tabs.more', "Tab Actions"),
	// allow-any-unicode-next-line
	close: chinese ? '关闭标签页' : localize('sp.tabs.close', "Close Tab"),
	// allow-any-unicode-next-line
	addFavorite: chinese ? '添加到收藏夹' : localize('sp.tabs.addFavorite', "Add to Favorites"),
	// allow-any-unicode-next-line
	removeFavorite: chinese ? '从收藏夹移除' : localize('sp.tabs.removeFavorite', "Remove from Favorites"),
	// allow-any-unicode-next-line
	splitRight: chinese ? '向右拆分' : localize('sp.tabs.splitRight', "Split Right"),
	// allow-any-unicode-next-line
	splitDown: chinese ? '向下拆分' : localize('sp.tabs.splitDown', "Split Down"),
	// allow-any-unicode-next-line
	previous: chinese ? '向前移动标签页' : localize('sp.tabs.previous', "Move Tab Before"),
	// allow-any-unicode-next-line
	next: chinese ? '向后移动标签页' : localize('sp.tabs.next', "Move Tab After"),
};

export interface BrowserTabBarItem {
	readonly key: string;
	readonly title: string;
	readonly url: string;
	readonly favicon?: string;
	readonly active: boolean;
	readonly opened?: boolean;
	readonly loading?: boolean;
	readonly groupLabel?: string;
}

export interface BrowserTabBarActions {
	select(key: string): Promise<void>;
	editUrl(key: string): void;
	close(key: string): void;
	move(key: string, targetKey: string): void;
	create(): void;
	setVertical(vertical: boolean): void;
	getMenu(key: string): IAction[];
}

/** Presents native browser inputs without owning their lifetime or navigation history. */
export class ShortestPathBrowserTabBar extends Disposable {
	readonly element: HTMLElement;
	private readonly rows = this._register(new DisposableStore());
	private readonly list: HTMLElement;
	private readonly favorites: HTMLElement;
	private readonly favoritesSummary: HTMLElement;
	private readonly favoritesContainer: HTMLElement;
	private readonly favoritesToggle: HTMLButtonElement;
	private favoritesCollapsed = false;
	private readonly toggle: HTMLButtonElement;
	private items: readonly BrowserTabBarItem[] = [];
	private favoriteItems: readonly BrowserTabBarItem[] = [];
	private readonly tabButtons = new Map<string, HTMLButtonElement>();
	private readonly listButtons = new Map<HTMLElement, HTMLButtonElement[]>();
	private vertical = false;

	constructor(container: HTMLElement, private readonly actions: BrowserTabBarActions, private readonly hover: IHoverService, private readonly contextMenu: IContextMenuService) {
		super();
		this.element = append(container, $('.shortestpath-browser-tabbar'));
		this.toggle = this.button(this.element, browserTabBarLabels.vertical, 'layout-sidebar-left', () => actions.setVertical(!this.vertical), this._store);
		this.toggle.classList.add('browser-layout-toggle');
		this.favoritesContainer = append(this.element, $('.browser-favorites-container'));
		this.favoritesToggle = this.button(this.favoritesContainer, browserTabBarLabels.collapseFavorites, 'star-full', () => this.setFavoritesCollapsed(!this.favoritesCollapsed), this._store);
		this.favoritesToggle.classList.add('browser-favorites-toggle');
		append(this.favoritesToggle, $('span.browser-favorites-chevron.codicon.codicon-chevron-left', { 'aria-hidden': 'true' }));
		this.favoritesToggle.setAttribute('aria-expanded', 'true');
		const reveal = append(this.favoritesContainer, $('.browser-favorites-reveal'));
		this.favorites = append(reveal, $('.browser-favorites', { role: 'group', 'aria-label': browserTabBarLabels.favorites }));
		this.favoritesSummary = append(this.favoritesContainer, $('.browser-favorites-summary', { role: 'group', 'aria-label': browserTabBarLabels.favorites }));
		this.favoritesSummary.hidden = true;
		this.list = append(this.element, $('.browser-tab-list', { role: 'tablist', 'aria-label': browserTabBarLabels.tabs }));
		const create = this.button(this.element, browserTabBarLabels.new, 'add', () => actions.create(), this._store);
		create.classList.add('browser-new-tab');
		append(create, $('span')).textContent = browserTabBarLabels.new;
	}

	setVertical(vertical: boolean): void {
		this.vertical = vertical;
		this.element.classList.toggle('vertical', vertical);
		this.toggle.setAttribute('aria-label', vertical ? browserTabBarLabels.horizontal : browserTabBarLabels.vertical);
		this.toggle.setAttribute('aria-pressed', String(vertical));
		this.list.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
	}

	update(items: readonly BrowserTabBarItem[], favorites: readonly BrowserTabBarItem[]): void {
		this.items = items;
		this.favoriteItems = favorites;
		this.render();
	}

	private setFavoritesCollapsed(collapsed: boolean): void {
		this.favoritesCollapsed = collapsed;
		if (this.favorites.contains(this.element.ownerDocument.activeElement) || this.favoritesSummary.contains(this.element.ownerDocument.activeElement)) {
			this.favoritesToggle.focus();
		}
		this.favorites.inert = collapsed;
		this.favoritesContainer.classList.toggle('collapsed', collapsed);
		this.favoritesToggle.setAttribute('aria-expanded', String(!collapsed));
		this.favoritesToggle.setAttribute('aria-label', collapsed ? browserTabBarLabels.expandFavorites : browserTabBarLabels.collapseFavorites);
		this.render();
	}

	private render(): void {
		const focused = this.element.ownerDocument.activeElement;
		const focusKey = isHTMLElement(focused) && this.element.contains(focused) ? focused.dataset.key : undefined;
		this.rows.clear();
		this.tabButtons.clear();
		this.listButtons.set(this.list, []);
		this.listButtons.set(this.favorites, []);
		this.listButtons.set(this.favoritesSummary, []);
		this.list.replaceChildren();
		this.favorites.replaceChildren();
		this.favoritesSummary.replaceChildren();
		this.favoritesSummary.hidden = !this.favoritesCollapsed;
		this.favorites.hidden = this.favoriteItems.length === 0;
		this.favoritesContainer.hidden = this.favoriteItems.length === 0;
		for (const item of this.favoriteItems) {
			this.row(this.favorites, item, true, !this.favoritesCollapsed);
			if (this.favoritesCollapsed && item.opened) { this.row(this.favoritesSummary, item, true); }
		}
		let groupLabel: string | undefined;
		for (const item of this.items) {
			if (item.groupLabel && item.groupLabel !== groupLabel) {
				groupLabel = item.groupLabel;
				append(this.list, $('.browser-tab-group')).textContent = groupLabel;
			}
			this.row(this.list, item, false);
		}
		if (focusKey) {
			(this.tabButtons.get(focusKey) ?? (this.favoritesCollapsed ? this.favoritesToggle : this.tabButtons.values().next().value ?? this.toggle)).focus();
		}
	}

	private row(container: HTMLElement, item: BrowserTabBarItem, favorite: boolean, trackFocus = true): void {
		const row = append(container, $('.browser-tab-row'));
		row.classList.toggle('active', item.active);
		row.classList.toggle('favorite', favorite);
		row.classList.toggle('opened', !!item.opened);
		const tab = append(row, $('button.browser-tab', { type: 'button', role: favorite ? 'button' : 'tab', 'aria-label': item.title, 'aria-selected': favorite ? undefined : String(item.active) })) as HTMLButtonElement;
		tab.dataset.key = item.key;
		if (trackFocus) { this.tabButtons.set(item.key, tab); }
		this.listButtons.get(container)!.push(tab);
		const icon = append(tab, $('span.browser-tab-icon', { 'aria-hidden': 'true' }));
		icon.classList.add('codicon', item.loading ? 'codicon-loading' : 'codicon-globe');
		icon.classList.toggle('codicon-modifier-spin', !!item.loading);
		if (item.favicon && !item.loading && /^(https?:|data:image\/)/i.test(item.favicon)) {
			const img = append(icon, $('img', { src: item.favicon, alt: '', referrerpolicy: 'no-referrer' })) as HTMLImageElement;
			this.rows.add(addDisposableListener(img, 'error', () => img.remove()));
		}
		append(tab, $('span.browser-tab-title')).textContent = item.title;
		this.rows.add(this.hover.setupManagedHover(getDefaultHoverDelegate('mouse'), tab, `${item.title}\n${item.url}`));
		this.rows.add(addDisposableListener(tab, EventType.CLICK, () => {
			if (item.active) { this.actions.editUrl(item.key); } else { void this.actions.select(item.key).catch(onUnexpectedError); }
		}));
		this.rows.add(addDisposableListener(tab, EventType.KEY_DOWN, (event: KeyboardEvent) => {
			const buttons = this.listButtons.get(container)!;
			const index = buttons.indexOf(tab);
			let target: number | undefined;
			if (event.key === (this.vertical ? 'ArrowDown' : 'ArrowRight')) { target = (index + 1) % buttons.length; }
			if (event.key === (this.vertical ? 'ArrowUp' : 'ArrowLeft')) { target = (index + buttons.length - 1) % buttons.length; }
			if (event.key === 'Home') { target = 0; }
			if (event.key === 'End') { target = buttons.length - 1; }
			if (target !== undefined) { event.preventDefault(); buttons[target].focus(); }
			if (event.key === 'Delete' && (!favorite || item.opened)) { event.preventDefault(); this.actions.close(item.key); }
			if (event.key === 'F2' && item.active) { event.preventDefault(); this.actions.editUrl(item.key); }
		}));
		if (!favorite) {
			tab.draggable = true;
			this.rows.add(addDisposableListener(tab, EventType.DRAG_START, (event: DragEvent) => {
				event.dataTransfer?.setData('application/shortestpath-browser-tab', item.key);
			}));
			this.rows.add(addDisposableListener(row, EventType.DRAG_OVER, (event: DragEvent) => {
				if (event.dataTransfer?.types.includes('application/shortestpath-browser-tab')) { event.preventDefault(); }
			}));
			this.rows.add(addDisposableListener(row, EventType.DROP, (event: DragEvent) => {
				const source = event.dataTransfer?.getData('application/shortestpath-browser-tab');
				if (source) { event.preventDefault(); this.actions.move(source, item.key); }
			}));
		}
		const menu = () => this.contextMenu.showContextMenu({ getAnchor: () => tab, getActions: () => this.actions.getMenu(item.key) });
		this.rows.add(addDisposableListener(tab, EventType.CONTEXT_MENU, (event: MouseEvent) => { event.preventDefault(); menu(); }));
		const more = this.button(row, browserTabBarLabels.more, 'ellipsis', menu, this.rows);
		more.classList.add('browser-tab-more');
		more.dataset.key = item.key;
		if (!favorite || item.opened) {
			const close = this.button(row, browserTabBarLabels.close, 'close', () => this.actions.close(item.key), this.rows);
			close.classList.add('browser-tab-close');
			close.dataset.key = item.key;
		}
	}

	private button(container: HTMLElement, label: string, icon: string, run: () => void, store: DisposableStore): HTMLButtonElement {
		const button = append(container, $('button.browser-tab-action', { type: 'button', 'aria-label': label })) as HTMLButtonElement;
		append(button, $(`span.codicon.codicon-${icon}`, { 'aria-hidden': 'true' }));
		store.add(this.hover.setupManagedHover(getDefaultHoverDelegate('mouse'), button, () => button.getAttribute('aria-label') ?? label));
		store.add(addDisposableListener(button, EventType.CLICK, run));
		return button;
	}
}
