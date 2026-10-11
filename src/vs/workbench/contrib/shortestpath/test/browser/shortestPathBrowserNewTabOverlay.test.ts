/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { BrowserNewTabEntry, ShortestPathBrowserNewTabOverlay } from '../../browser/shortestPathBrowserNewTabOverlay.js';

suite('ShortestPath floating browser new tab', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('favorites are visible before typing and keyboard selection switches an existing page', () => {
		const actions: string[] = [];
		const overlay = store.add(new ShortestPathBrowserNewTabOverlay(document.body, [
			{ title: 'Favorite', url: 'https://example.com/favorite', favorite: true, run: () => actions.push('favorite') },
			{ title: 'Existing', url: 'https://example.com/open', favorite: false, run: () => actions.push('existing') },
		], text => actions.push(text), accepted => actions.push(String(accepted))));
		const labels = [...overlay.element.getElementsByClassName('browser-new-tab-title')].map(element => element.textContent);
		overlay.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		overlay.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.deepStrictEqual({ labels, actions }, { labels: ['Favorite', 'Existing'], actions: ['true', 'existing'] });
	});

	test('search filters favorites and offers navigation; Escape cancels without navigating', () => {
		const actions: string[] = [];
		const overlay = store.add(new ShortestPathBrowserNewTabOverlay(document.body, [
			{ title: 'OI Wiki', url: 'https://oi-wiki.org', favorite: true, run: () => actions.push('favorite') },
			{ title: 'Other', url: 'https://example.com', favorite: false, run: () => actions.push('existing') },
		], text => actions.push(text), accepted => actions.push(String(accepted))));
		overlay.input.value = 'wiki'; overlay.input.dispatchEvent(new mainWindow.Event('input', { bubbles: true }));
		const labels = [...overlay.element.getElementsByClassName('browser-new-tab-title')].map(element => element.textContent);
		overlay.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));
		overlay.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		assert.deepStrictEqual({ labels, actions }, { labels: ['wiki', 'OI Wiki'], actions: ['false'] });
	});

	test('Tab keeps focus inside the panel and disposal removes the backdrop', () => {
		const overlay = store.add(new ShortestPathBrowserNewTabOverlay(document.body, [], () => { }, () => { }));
		overlay.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
		const trapped = overlay.element.contains(document.activeElement) && document.activeElement !== overlay.input;
		overlay.dispose();
		assert.deepStrictEqual({ trapped, connected: overlay.element.isConnected }, { trapped: true, connected: false });
	});
	test('live suggestions follow typing, ignore stale results and cancel on close', async () => {
		const requests: { text: string; token: CancellationToken; result: DeferredPromise<readonly BrowserNewTabEntry[]> }[] = [];
		const overlay = store.add(new ShortestPathBrowserNewTabOverlay(document.body, [], () => { }, () => { }, {
			getEntries: (text, token) => { const result = new DeferredPromise<readonly BrowserNewTabEntry[]>(); requests.push({ text, token, result }); return result.p; },
		}));
		const type = (value: string) => { overlay.input.value = value; overlay.input.dispatchEvent(new mainWindow.Event('input', { bubbles: true })); };
		type('old'); type('new');
		await requests[2].result.complete([{ id: 'history:new', title: 'New history', url: 'https://new.example.com', section: 'History', favorite: false, navigate: true, run: () => { } }]);
		await requests[1].result.complete([{ title: 'Old history', url: 'https://old.example.com', favorite: false, run: () => { } }]);
		const labels = [...overlay.element.getElementsByClassName('browser-new-tab-title')].map(element => element.textContent);
		overlay.dispose();
		assert.deepStrictEqual({ queries: requests.map(request => request.text), cancelled: requests.map(request => request.token.isCancellationRequested), labels }, { queries: ['', 'old', 'new'], cancelled: [true, true, true], labels: ['new', 'New history'] });
		await requests[0].result.complete([]);
	});

	test('background suggestions preserve arrow selection and provider changes refresh the current query', async () => {
		const change = store.add(new Emitter<void>());
		const selected: string[] = [];
		let revision = 0;
		const suggestion: BrowserNewTabEntry = { id: 'history:wiki', title: 'Wiki history', url: 'https://wiki.example.com', section: 'History', favorite: false, navigate: true, run: () => selected.push('history') };
		const overlay = store.add(new ShortestPathBrowserNewTabOverlay(document.body, [], () => { }, () => { }, {
			onDidChange: change.event,
			getEntries: async () => { revision++; return [suggestion]; },
		}));
		overlay.input.value = 'wiki'; overlay.input.dispatchEvent(new mainWindow.Event('input', { bubbles: true }));
		await Promise.resolve();
		overlay.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		change.fire(); await Promise.resolve();
		overlay.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		assert.deepStrictEqual({ revision, selected }, { revision: 3, selected: ['history'] });
	});

	test('provider refresh retains keyboard focus inside a focused result row', async () => {
		const change = store.add(new Emitter<void>());
		const overlay = store.add(new ShortestPathBrowserNewTabOverlay(document.body, [], () => { }, () => { }, {
			onDidChange: change.event,
			getEntries: async () => [{ id: 'history:wiki', title: 'Wiki', url: 'https://wiki.example.com', favorite: false, run: () => { } }],
		}));
		await Promise.resolve();
		overlay.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
		change.fire(); await Promise.resolve();
		assert.strictEqual(overlay.element.ownerDocument.activeElement?.getAttribute('role'), 'option');
	});

});
