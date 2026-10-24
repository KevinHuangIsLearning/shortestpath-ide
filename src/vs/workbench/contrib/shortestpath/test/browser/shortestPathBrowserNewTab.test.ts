/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BrowserNewTabFavorites, createShortestPathBrowserNewTab } from '../../browser/shortestPathBrowserNewTab.js';
import { shortestPathHome } from '../../common/shortestPathMode.js';

suite('ShortestPath browser New Tab', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('OJ topic shortcut navigates the current tab without a duplicate address field', () => {
		const listeners = store.add(new DisposableStore());
		const navigations: string[] = [];
		const page = createShortestPathBrowserNewTab(listeners, url => navigations.push(url));
		const shortcut = page.querySelector<HTMLButtonElement>('.shortestpath-browser-new-tab-shortcut')!;
		shortcut.click();
		listeners.dispose();
		shortcut.click();
		assert.deepStrictEqual({ navigations, addressFields: page.querySelectorAll('form, input').length, label: !!shortcut.querySelector('.shortestpath-browser-new-tab-shortcut-title') }, { navigations: [shortestPathHome], addressFields: 0, label: true });
	});
	test('favorites update live, navigate this tab and release listeners on disposal', () => {
		const listeners = store.add(new DisposableStore());
		const change = store.add(new Emitter<void>());
		const favorites = { values: ['https://one.example/'], get entries() { return this.values.map(url => ({ url })); }, compact: false, onDidChange: change.event, rename() { }, remove() { }, move() { }, setCompact() { } };
		const navigations: string[] = [];
		const page = createShortestPathBrowserNewTab(listeners, url => navigations.push(url), favorites);
		page.querySelector<HTMLButtonElement>('.shortestpath-browser-new-tab-favorite')!.click();
		favorites.values = ['https://two.example/'];
		change.fire();
		const button = page.querySelector<HTMLButtonElement>('.shortestpath-browser-new-tab-favorite')!;
		button.click();
		favorites.values = [];
		change.fire();
		assert.deepStrictEqual({ navigations, hidden: page.querySelector<HTMLElement>('section')!.hidden, count: page.querySelectorAll('.shortestpath-browser-new-tab-favorite').length }, {
			navigations: ['https://one.example/', 'https://two.example/'], hidden: true, count: 0,
		});
		listeners.dispose();
		button.click();
		favorites.values = ['https://three.example/'];
		change.fire();
		assert.deepStrictEqual({ navigations, count: page.querySelectorAll('.shortestpath-browser-new-tab-favorite').length }, { navigations: ['https://one.example/', 'https://two.example/'], count: 0 });
	});

	test('renders metadata safely and supports rename, keyboard order, drag order and icon layout', () => {
		const change = store.add(new Emitter<void>());
		const entries = [
			{ url: 'https://one.example/', title: '<b>Page One</b>', favicon: 'data:image/png;base64,AAAA', name: '' },
			{ url: 'https://two.example/', title: 'Page Two', favicon: 'javascript:alert(1)', name: '' },
		];
		const favorites: BrowserNewTabFavorites = {
			get values() { return entries.map(entry => entry.url); }, entries, compact: false, onDidChange: change.event,
			rename(url, name) { entries.find(entry => entry.url === url)!.name = name; change.fire(); },
			remove() { },
			move(url, target) { const entry = entries.splice(entries.findIndex(entry => entry.url === url), 1)[0]; entries.splice(entries.findIndex(entry => entry.url === target), 0, entry); change.fire(); },
			setCompact(compact) { Object.assign(this, { compact }); change.fire(); },
		};
		const page = createShortestPathBrowserNewTab(store.add(new DisposableStore()), () => { }, favorites);
		assert.deepStrictEqual({ name: page.querySelector('.shortestpath-browser-new-tab-favorite-name')!.textContent, markup: page.querySelector('b'), icons: page.querySelectorAll('img').length }, { name: '<b>Page One</b>', markup: null, icons: 1 });
		page.querySelector<HTMLButtonElement>('.shortestpath-browser-new-tab-favorite-edit')!.click();
		const input = page.querySelector<HTMLInputElement>('input')!;
		input.value = 'My Name';
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		page.querySelector<HTMLButtonElement>('.shortestpath-browser-new-tab-favorite')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true }));
		assert.deepStrictEqual(favorites.values, ['https://two.example/', 'https://one.example/']);
		const rows = page.querySelectorAll<HTMLElement>('.shortestpath-browser-new-tab-favorite-row');
		rows[1].dispatchEvent(new Event('dragstart'));
		rows[0].dispatchEvent(new Event('drop', { cancelable: true }));
		page.querySelector<HTMLButtonElement>('.shortestpath-browser-new-tab-favorite-edit')!.click();
		const cancelled = page.querySelector<HTMLInputElement>('input')!;
		cancelled.value = 'Cancelled';
		cancelled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		page.querySelectorAll<HTMLButtonElement>('.shortestpath-browser-new-tab-layouts button')[1].click();
		assert.deepStrictEqual({ name: page.querySelector('.shortestpath-browser-new-tab-favorite-name')!.textContent, order: favorites.values, compact: page.querySelector('section')!.classList.contains('compact'), pressed: page.querySelectorAll('button[aria-pressed="true"]').length }, {
			name: 'My Name', order: ['https://one.example/', 'https://two.example/'], compact: true, pressed: 1,
		});
	});

});
