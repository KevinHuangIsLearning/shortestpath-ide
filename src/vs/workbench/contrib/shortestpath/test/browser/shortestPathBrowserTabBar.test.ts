/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
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
		bar.update(items, []);
		bar.element.querySelectorAll<HTMLButtonElement>('.browser-tab')[1].click();
		await Promise.resolve();
		bar.element.querySelector<HTMLButtonElement>('.browser-tab')!.click();
		bar.update([{ ...items[0], title: 'Changed', loading: true }, items[1]], []);
		assert.deepStrictEqual({ calls, ownInput: !!bar.element.querySelector('input'), title: bar.element.querySelectorAll('.browser-tab-title')[1].textContent }, {
			calls: ['select:2:two', 'edit:1:one'], ownInput: false, title: '<b>Two</b>',
		});
	});

	test('vertical keyboard movement changes focus without switching pages or editing URLs', () => {
		const calls: string[] = [];
		const bar = create({ select: async key => { calls.push(key); }, editUrl: () => calls.push('edit') });
		bar.setVertical(true);
		bar.update([{ key: '1:a', title: 'A', url: 'https://a.example', active: true }, { key: '1:b', title: 'B', url: 'https://b.example', active: false }], []);
		const first = bar.element.querySelector<HTMLButtonElement>('.browser-tab')!;
		first.focus();
		first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
		assert.deepStrictEqual({ calls, focusedKey: (document.activeElement as HTMLElement).dataset.key, orientation: bar.element.querySelector('[role="tablist"]')?.getAttribute('aria-orientation') }, {
			calls: [], focusedKey: '1:b', orientation: 'vertical',
		});
	});

	test('favorites delegate editing only when their page is selected', () => {
		const calls: string[] = [];
		const bar = create({ select: async key => { calls.push(`select:${key}`); }, editUrl: key => { calls.push(`edit:${key}`); } });
		const favorite = { key: 'favorite:https://a.example/', title: 'A', url: 'https://a.example/', active: false };
		bar.update([], [favorite]);
		bar.element.querySelector<HTMLButtonElement>('.favorite .browser-tab')!.click();
		bar.update([], [{ ...favorite, active: true }]);
		bar.element.querySelector<HTMLButtonElement>('.favorite .browser-tab')!.click();
		assert.deepStrictEqual(calls, [`select:${favorite.key}`, `edit:${favorite.key}`]);
	});

	test('favorites use their context menu without a more button in either layout', () => {
		const calls: string[] = [];
		const bar = create({ getMenu: key => { calls.push(key); return []; } });
		const favorite = { key: 'favorite:https://a.example/', title: 'A', url: 'https://a.example/', active: false };
		for (const vertical of [false, true]) {
			bar.setVertical(vertical);
			bar.update([], [favorite]);
			assert.strictEqual(bar.element.querySelector('.favorite .browser-tab-more'), null);
			bar.element.querySelector<HTMLButtonElement>('.favorite .browser-tab')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
		}
		assert.deepStrictEqual(calls, [favorite.key, favorite.key]);
	});

	test('gives the favorites star and arrow equal slots with each icon centered in both layouts', () => {
		const bar = create();
		bar.update([], [{ key: 'favorite:https://a.example/', title: 'A', url: 'https://a.example/', active: false }]);
		for (const vertical of [false, true]) {
			bar.setVertical(vertical);
			bar.element.classList.toggle('native-leading', !vertical);
			for (const collapsed of [false, true]) {
				const toggle = bar.element.querySelector<HTMLButtonElement>('.browser-favorites-toggle')!;
				if ((toggle.getAttribute('aria-expanded') === 'false') !== collapsed) { toggle.click(); }
				const button = toggle.getBoundingClientRect();
				const [star, chevron] = Array.from(toggle.children, child => child.getBoundingClientRect());
				assert.ok(button.width > 0 && Math.abs(star.width - button.width / 2) < 1 && Math.abs(chevron.width - star.width) < 1);
				assert.ok(Math.abs(star.left + star.width / 2 - button.left - button.width / 4) < 1);
				assert.ok(Math.abs(chevron.left + chevron.width / 2 - button.left - button.width * 3 / 4) < 1);
				assert.ok(Math.abs(star.top + star.height / 2 - button.top - button.height / 2) < 1);
				assert.ok(Math.abs(chevron.top + chevron.height / 2 - button.top - button.height / 2) < 1);
			}
		}
	});

	test('centers favorite icons in horizontal, native and collapsed layouts', () => {
		const bar = create();
		const favorite = { key: 'favorite:https://a.example/', title: 'A', url: 'https://a.example/', active: false };
		const assertCentered = (selector: string) => {
			const tab = bar.element.querySelector<HTMLElement>(selector)!;
			const button = tab.getBoundingClientRect();
			const icon = tab.querySelector<HTMLElement>('.browser-tab-icon')!.getBoundingClientRect();
			assert.ok(button.width > 0 && Math.abs(icon.left + icon.width / 2 - button.left - button.width / 2) < 1);
		};
		bar.update([], [favorite]);
		assertCentered('.favorite .browser-tab');
		bar.element.classList.add('native-leading');
		assertCentered('.favorite .browser-tab');
		bar.update([], [{ ...favorite, opened: true }]);
		bar.element.querySelector<HTMLButtonElement>('.browser-favorites-toggle')!.click();
		assertCentered('.browser-favorites-summary .browser-tab');
	});

	test('lays out chrome outside the webpage and sizes favorites to their content', () => {
		const bar = create();
		const surface = bar.element.parentElement!;
		surface.style.cssText = 'display:flex;flex-direction:column;width:800px;height:600px';
		const host = document.createElement('div');
		host.className = 'shortestpath-browser-host';
		surface.appendChild(host);
		bar.update([{ key: '1:a', title: 'A', url: 'https://a.example/', active: true }], [{ key: 'favorite:https://a.example/', title: 'A', url: 'https://a.example/', active: true }]);
		const horizontal = bar.element.getBoundingClientRect();
		const horizontalHost = host.getBoundingClientRect();
		assert.ok(horizontalHost.top >= horizontal.bottom && horizontalHost.height > 0);
		assert.ok(bar.element.querySelector<HTMLElement>('.browser-favorites')!.getBoundingClientRect().width < 100);
		bar.setVertical(true);
		surface.style.flexDirection = 'row';
		const vertical = bar.element.getBoundingClientRect();
		const verticalHost = host.getBoundingClientRect();
		const favorite = bar.element.querySelector<HTMLElement>('.favorite')!.getBoundingClientRect();
		assert.ok(verticalHost.left >= vertical.right && verticalHost.width > 0 && favorite.height < 80);
	});

	test('renders favorites separately in both layouts and retains focused tab after title refresh', () => {
		const bar = create();
		const item = { key: '1:one', title: 'One', url: 'https://one.example/', active: true };
		bar.update([item], [{ ...item, key: 'favorite:https://one.example/' }]);
		bar.element.querySelector<HTMLButtonElement>('.browser-tab-list .browser-tab')!.focus();
		bar.update([{ ...item, title: 'Updated' }], []);
		assert.deepStrictEqual({ focused: (document.activeElement as HTMLElement).dataset.key, favoritesHidden: (bar.element.querySelector('.browser-favorites') as HTMLElement).hidden, title: bar.element.querySelector('.browser-tab-title')?.textContent }, {
			focused: '1:one', favoritesHidden: true, title: 'Updated',
		});
	});
	test('a closed favorite expands in place while open and collapses after closing', () => {
		const closed: string[] = [];
		const bar = create({ close: key => closed.push(key) });
		bar.element.classList.add('native-leading');
		const favorite = { key: 'favorite:https://one.example/', title: 'Favorite page', url: 'https://one.example/', active: false };
		bar.update([], [favorite]);
		const titleVisible = () => mainWindow.getComputedStyle(bar.element.querySelector<HTMLElement>('.browser-tab-title')!).display !== 'none';
		const initial = titleVisible();
		bar.update([], [{ ...favorite, opened: true, active: true }]);
		const expanded = titleVisible();
		bar.element.querySelector<HTMLButtonElement>('.favorite .browser-tab-close')!.click();
		bar.update([], [favorite]);
		assert.deepStrictEqual({ initial, expanded, collapsed: !titleVisible(), closed, favorites: bar.element.querySelectorAll('.favorite').length }, {
			initial: false, expanded: true, collapsed: true, closed: [favorite.key], favorites: 1,
		});
	});

	test('collapses the favorites container with animation and preserves pages across refresh', async () => {
		const calls: string[] = [];
		const bar = create({ select: async key => { calls.push(key); } });
		bar.element.classList.add('native-leading');
		bar.element.parentElement!.style.width = '800px';
		const favorite = { key: 'favorite:https://one.example/', title: 'Favorite page', url: 'https://one.example/', active: false, opened: true };
		bar.update([], [favorite]);
		const container = bar.element.querySelector<HTMLElement>('.browser-favorites-container')!;
		const toggle = container.querySelector<HTMLButtonElement>('.browser-favorites-toggle')!;
		const favorites = container.querySelector<HTMLElement>('.browser-favorites')!;
		const reveal = container.querySelector<HTMLElement>('.browser-favorites-reveal')!;
		const expandedWidth = container.getBoundingClientRect().width;
		assert.ok(parseFloat(mainWindow.getComputedStyle(reveal).transitionDuration) > 0);
		favorites.querySelector<HTMLButtonElement>('.browser-tab')!.focus();
		toggle.click();
		bar.update([], [{ ...favorite, title: 'Updated' }]);
		await new Promise<void>(resolve => mainWindow.setTimeout(resolve, 250));
		assert.deepStrictEqual({ collapsed: container.classList.contains('collapsed'), inert: favorites.inert, expanded: toggle.getAttribute('aria-expanded'), focused: document.activeElement === toggle, calls }, {
			collapsed: true, inert: true, expanded: 'false', focused: true, calls: [],
		});
		const collapsedWidth = container.getBoundingClientRect().width;
		assert.ok(collapsedWidth < expandedWidth / 2);
		assert.strictEqual(reveal.getBoundingClientRect().width, 0);
		toggle.click();
		await new Promise<void>(resolve => mainWindow.setTimeout(resolve, 250));
		favorites.querySelector<HTMLButtonElement>('.browser-tab')!.click();
		assert.deepStrictEqual({ inert: favorites.inert, expanded: toggle.getAttribute('aria-expanded'), title: favorites.querySelector('.browser-tab-title')!.textContent, calls }, {
			inert: false, expanded: 'true', title: 'Updated', calls: [favorite.key],
		});
		assert.ok(container.getBoundingClientRect().width > collapsedWidth * 2);
		bar.update([], []);
		assert.ok(container.hidden);
	});

	test('collapsed favorites retain only opened page icons and their tab interactions', () => {
		const calls: string[] = [];
		const bar = create({ select: async key => { calls.push(`select:${key}`); }, editUrl: key => { calls.push(`edit:${key}`); } });
		bar.element.classList.add('native-leading');
		const favorites = [
			{ key: 'closed', title: 'Closed page', url: 'https://closed.example/', active: false },
			{ key: 'opened', title: 'Opened page', url: 'https://opened.example/', active: false, opened: true },
			{ key: 'active', title: 'Current page', url: 'https://current.example/', active: true, opened: true },
		];
		bar.update([], favorites);
		const toggle = bar.element.querySelector<HTMLButtonElement>('.browser-favorites-toggle')!;
		toggle.click();
		const summary = bar.element.querySelector<HTMLElement>('.browser-favorites-summary')!;
		const buttons = summary.querySelectorAll<HTMLButtonElement>('.browser-tab');
		buttons[0].click();
		buttons[1].click();
		buttons[0].focus();
		bar.update([], favorites);
		assert.deepStrictEqual({ keys: Array.from(buttons, button => button.dataset.key), calls, titleDisplay: mainWindow.getComputedStyle(summary.querySelector<HTMLElement>('.browser-tab-title')!).display, focused: (document.activeElement as HTMLElement).dataset.key }, {
			keys: ['opened', 'active'], calls: ['select:opened', 'edit:active'], titleDisplay: 'none', focused: 'opened',
		});
		bar.update([], [favorites[0]]);
		assert.strictEqual(summary.children.length, 0);
		assert.strictEqual(document.activeElement, toggle);
		toggle.click();
		assert.ok(summary.hidden);
		assert.strictEqual(bar.element.querySelectorAll('.browser-favorites .browser-tab').length, 1);
	});

});
