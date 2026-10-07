/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/shortestPathBrowserNewTab.css';
import { $, addDisposableListener, append } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { shortestPathHome } from '../common/shortestPathMode.js';
import { localizeNewTab } from './shortestPathNewTabInput.js';

/** Start page inside an empty native browser editor; navigation stays in this tab. */
export function createShortestPathBrowserNewTab(store: DisposableStore, navigate: (url: string) => void): HTMLElement {
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
	return container;
}
