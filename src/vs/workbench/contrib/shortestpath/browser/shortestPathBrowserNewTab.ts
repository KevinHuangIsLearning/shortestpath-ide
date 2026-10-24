/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/shortestPathBrowserNewTab.css';
import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { getDefaultHoverDelegate } from '../../../../base/browser/ui/hover/hoverDelegateFactory.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { toAction } from '../../../../base/common/actions.js';
import { Event } from '../../../../base/common/event.js';
import { browserTabBarLabels } from './shortestPathBrowserTabBar.js';
import { shortestPathHome } from '../common/shortestPathMode.js';
import { localizeNewTab } from './shortestPathNewTabInput.js';

export interface BrowserNewTabFavorites {
	readonly values: readonly string[];
	readonly entries: readonly { url: string; title?: string; favicon?: string; name?: string }[];
	readonly compact: boolean;
	readonly onDidChange: Event<void>;
	rename(url: string, name: string): void;
	remove(url: string): void;
	move(url: string, target: string): void;
	setCompact(compact: boolean): void;
}

const favoriteLabels = {
	// allow-any-unicode-next-line
	rename: localizeNewTab('Rename', '重命名'),
	// allow-any-unicode-next-line
	icons: localizeNewTab('Small Icons', '小图标'),
	// allow-any-unicode-next-line
	list: localizeNewTab('List', '列表'),
	// allow-any-unicode-next-line
	before: localizeNewTab('Move Before', '向前移动'),
	// allow-any-unicode-next-line
	after: localizeNewTab('Move After', '向后移动'),
};

/** Start page inside an empty native browser editor; navigation stays in this tab. */
export function createShortestPathBrowserNewTab(store: DisposableStore, navigate: (url: string) => void, favorites?: BrowserNewTabFavorites, services?: { hover: IHoverService; contextMenu: IContextMenuService }): HTMLElement {
	const container = $('.shortestpath-browser-new-tab');
	const content = append(container, $('.shortestpath-browser-new-tab-content'));
	append(content, $('p.shortestpath-browser-new-tab-brand', undefined, 'ShortestPath'));
	// allow-any-unicode-next-line
	append(content, $('h1', undefined, localizeNewTab('New Tab', '新建标签页')));
	// allow-any-unicode-next-line
	append(content, $('p.shortestpath-browser-new-tab-description', undefined, localizeNewTab('Choose a topic and start solving problems.', '选择专题，开始做题。')));
	const shortcut = append(content, $('button.shortestpath-browser-new-tab-shortcut', { type: 'button' }));
	append(shortcut, $('span.codicon.codicon-mortar-board', { 'aria-hidden': 'true' }));
	const label = append(shortcut, $('span.shortestpath-browser-new-tab-shortcut-label'));
	append(label, $('span.shortestpath-browser-new-tab-shortcut-title', undefined, 'ShortestPath OJ'));
	// allow-any-unicode-next-line
	append(label, $('span.shortestpath-browser-new-tab-shortcut-description', undefined, localizeNewTab('Browse Topics', '浏览专题')));
	store.add(addDisposableListener(shortcut, 'click', () => navigate(shortestPathHome)));
	if (favorites) {
		const section = append(content, $('section.shortestpath-browser-new-tab-favorites'));
		const header = append(section, $('.shortestpath-browser-new-tab-favorites-header'));
		append(header, $('h2', undefined, browserTabBarLabels.favorites));
		const layouts = append(header, $('.shortestpath-browser-new-tab-layouts', { role: 'group', 'aria-label': browserTabBarLabels.favorites }));
		const layoutButtons = [false, true].map(compact => {
			const button = append(layouts, $('button', { type: 'button', 'aria-label': compact ? favoriteLabels.icons : favoriteLabels.list }));
			append(button, $(`span.codicon.codicon-${compact ? 'symbol-array' : 'list-unordered'}`, { 'aria-hidden': 'true' }));
			append(button, $('span', undefined, compact ? favoriteLabels.icons : favoriteLabels.list));
			store.add(addDisposableListener(button, 'click', () => favorites.setCompact(compact)));
			return button;
		});
		const list = append(section, $('.shortestpath-browser-new-tab-favorites-list'));
		const listeners = store.add(new DisposableStore());
		let dragged: string | undefined;
		const buttons = new Map<string, HTMLElement>();
		const render = () => {
			const focused = list.contains(list.ownerDocument.activeElement) ? (list.ownerDocument.activeElement as HTMLElement).dataset.url : undefined;
			listeners.clear();
			list.replaceChildren();
			section.hidden = favorites.values.length === 0;
			section.classList.toggle('compact', favorites.compact);
			layoutButtons.forEach((button, index) => button.setAttribute('aria-pressed', String(Boolean(index) === favorites.compact)));
			buttons.clear();
			const rows: HTMLElement[] = [];
			for (const entry of favorites.entries) {
				const { url } = entry;
				const name = entry.name || entry.title || URL.parse(url)?.hostname || url;
				const row = append(list, $('.shortestpath-browser-new-tab-favorite-row'));
				rows.push(row);
				row.draggable = true;
				row.dataset.url = url;
				const button = append(row, $('button.shortestpath-browser-new-tab-favorite', { type: 'button', 'aria-label': name }));
				button.dataset.url = url;
				buttons.set(url, button);
				const icon = append(button, $('span.shortestpath-browser-new-tab-favorite-icon.codicon.codicon-globe', { 'aria-hidden': 'true' }));
				const pageUrl = URL.parse(url);
				const favicon = entry.favicon || (pageUrl && /^https?:$/.test(pageUrl.protocol) ? new URL('/favicon.ico', pageUrl).href : undefined);
				if (favicon && /^(https?:|data:image\/)/i.test(favicon)) {
					const img = append(icon, $('img', { src: favicon, alt: '', referrerpolicy: 'no-referrer' }));
					listeners.add(addDisposableListener(img, 'error', () => img.remove()));
				}
				const label = append(button, $('span.shortestpath-browser-new-tab-favorite-label'));
				append(label, $('span.shortestpath-browser-new-tab-favorite-name', undefined, name));
				append(label, $('span.shortestpath-browser-new-tab-favorite-url', undefined, url));
				if (services) { listeners.add(services.hover.setupManagedHover(getDefaultHoverDelegate('mouse'), button, `${name}\n${url}`)); }
				listeners.add(addDisposableListener(button, 'click', () => navigate(url)));
				let editing = false;
				const rename = () => {
					if (editing) { return; }
					editing = true;
					row.draggable = false;
					const input = append(row, $('input.shortestpath-browser-new-tab-favorite-rename', { type: 'text', 'aria-label': favoriteLabels.rename })) as HTMLInputElement;
					input.value = entry.name || entry.title || name;
					let finished = false;
					const finish = (save: boolean) => {
						if (finished) { return; }
						finished = true;
						editing = false;
						input.remove();
						row.draggable = true;
						if (save) { favorites.rename(url, input.value); }
						buttons.get(url)?.focus();
					};
					listeners.add(addDisposableListener(input, 'keydown', (event: KeyboardEvent) => {
						if (event.key === 'Enter' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(event.key === 'Enter'); }
					}));
					listeners.add(addDisposableListener(input, 'blur', () => finish(true)));
					input.focus();
					input.select();
				};
				const index = favorites.values.indexOf(url);
				const moveBefore = () => { if (index > 0) { favorites.move(url, favorites.values[index - 1]); } };
				const moveAfter = () => { if (index < favorites.values.length - 1) { favorites.move(favorites.values[index + 1], url); } };
				const actions = [
					{ id: 'rename', label: favoriteLabels.rename, enabled: true, run: rename },
					{ id: 'before', label: favoriteLabels.before, enabled: index > 0, run: moveBefore },
					{ id: 'after', label: favoriteLabels.after, enabled: index < favorites.values.length - 1, run: moveAfter },
					{ id: 'remove', label: browserTabBarLabels.removeFavorite, enabled: true, run: () => favorites.remove(url) },
				].map(action => toAction(action));
				const menu = () => services?.contextMenu.showContextMenu({ getAnchor: () => button, getActions: () => actions });
				const edit = append(row, $('button.shortestpath-browser-new-tab-favorite-edit', { type: 'button', 'aria-label': favoriteLabels.rename }));
				append(edit, $('span.codicon.codicon-edit', { 'aria-hidden': 'true' }));
				listeners.add(addDisposableListener(edit, 'click', rename));
				if (services) {
					const more = append(row, $('button.shortestpath-browser-new-tab-favorite-more', { type: 'button', 'aria-label': browserTabBarLabels.more }));
					append(more, $('span.codicon.codicon-ellipsis', { 'aria-hidden': 'true' }));
					listeners.add(addDisposableListener(more, 'click', menu));
					listeners.add(addDisposableListener(row, 'contextmenu', (event: MouseEvent) => { event.preventDefault(); menu(); }));
				}
				listeners.add(addDisposableListener(button, 'keydown', (event: KeyboardEvent) => {
					if (event.key === 'F2') { event.preventDefault(); rename(); }
					if (event.altKey && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(event.key)) {
						event.preventDefault();
						if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { moveBefore(); } else { moveAfter(); }
					}
				}));
				listeners.add(addDisposableListener(row, 'dragstart', (event: DragEvent) => {
					dragged = url;
					event.dataTransfer?.setData('application/shortestpath-favorite', url);
					if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; }
				}));
				listeners.add(addDisposableListener(row, 'dragover', (event: DragEvent) => {
					if (dragged && dragged !== url) { event.preventDefault(); row.classList.add('drop-target'); }
				}));
				listeners.add(addDisposableListener(row, 'dragleave', () => row.classList.remove('drop-target')));
				listeners.add(addDisposableListener(row, 'dragend', () => { dragged = undefined; rows.forEach(target => target.classList.remove('drop-target')); }));
				listeners.add(addDisposableListener(row, 'drop', (event: DragEvent) => {
					event.preventDefault();
					const source = dragged;
					dragged = undefined;
					if (source) { favorites.move(source, url); }
				}));
				if (url === focused) { button.focus(); }
			}
		};
		store.add(favorites.onDidChange(render));
		render();
	}
	return container;
}
