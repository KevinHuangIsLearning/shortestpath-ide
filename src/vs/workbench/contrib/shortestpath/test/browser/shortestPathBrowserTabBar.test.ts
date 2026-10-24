/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { BrowserTabBarActions, ShortestPathBrowserTabBar } from '../../browser/shortestPathBrowserTabBar.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';

suite('ShortestPath browser tab bar', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function create(actions: Partial<BrowserTabBarActions> = {}) {
		const container = document.createElement('div');
		document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		const instantiation = workbenchInstantiationService(undefined, store);
		return store.add(new ShortestPathBrowserTabBar(container, {
			select: async () => { }, editUrl: () => { }, close: () => { }, move: () => { }, create: () => { }, setVertical: () => { }, getMenu: () => [], ...actions,
		}, instantiation.invokeFunction(accessor => accessor.get(IHoverService)), new class extends mock<IContextMenuService>() { override showContextMenu(options: Parameters<IContextMenuService['showContextMenu']>[0]) { options.getActions?.(); } }));
	}

	test('switches inactive tabs and delegates selected-tab URL editing to the existing address bar', async () => {
		const calls: string[] = [];
		const bar = create({ select: async key => { calls.push(`select:${key}`); }, editUrl: key => { calls.push(`edit:${key}`); } });
		const items = [
			{ key: '1:one', title: 'One', url: 'https://one.example/', active: true },
			{ key: '2:two', title: '<b>Two</b>', url: 'https://two.example/', active: false },
		];
		bar.update(items);
		bar.element.querySelectorAll<HTMLButtonElement>('.browser-tab')[1].click();
		await Promise.resolve();
		bar.element.querySelector<HTMLButtonElement>('.browser-tab')!.click();
		bar.update([{ ...items[0], title: 'Changed', loading: true }, items[1]]);
		assert.deepStrictEqual({ calls, ownInput: !!bar.element.querySelector('input'), title: bar.element.querySelectorAll('.browser-tab-title')[1].textContent }, {
			calls: ['select:2:two', 'edit:1:one'], ownInput: false, title: '<b>Two</b>',
		});
	});

	test('vertical keyboard movement changes focus without switching pages or editing URLs', () => {
		const calls: string[] = [];
		const bar = create({ select: async key => { calls.push(key); }, editUrl: () => calls.push('edit') });
		bar.setVertical(true);
		bar.update([{ key: '1:a', title: 'A', url: 'https://a.example', active: true }, { key: '1:b', title: 'B', url: 'https://b.example', active: false }]);
		const first = bar.element.querySelector<HTMLButtonElement>('.browser-tab')!;
		first.focus();
		first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		assert.deepStrictEqual({ calls, focusedKey: (document.activeElement as HTMLElement).dataset.key, orientation: bar.element.querySelector('[role="tablist"]')?.getAttribute('aria-orientation') }, {
			calls: [], focusedKey: '1:b', orientation: 'vertical',
		});
	});

	test('renders ordinary tabs in both layouts and preserves focus on refresh', () => {
		const bar = create();
		const item = { key: '1:one', title: 'One', url: 'https://one.example/', active: true };
		for (const vertical of [false, true]) {
			bar.setVertical(vertical);
			bar.update([item]);
			bar.element.querySelector<HTMLButtonElement>('.browser-tab')!.focus();
			bar.update([{ ...item, title: 'Updated' }]);
			assert.deepStrictEqual({ focused: (document.activeElement as HTMLElement).dataset.key, title: bar.element.querySelector('.browser-tab-title')?.textContent, favorites: bar.element.querySelector('.browser-favorites-container') }, {
				focused: item.key, title: 'Updated', favorites: null,
			});
		}
	});
});
