/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../../browser/media/shortestPathMode.css';
import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('ShortestPath browser tabs', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createTabs(fontSize: number, width: number, titles: string[]) {
		const surface = append(mainWindow.document.body, $('.shortestpath-browser-space'));
		surface.style.cssText = `position: absolute; width: ${width}px; font: ${fontSize}px system-ui;`;
		store.add(toDisposable(() => surface.remove()));
		const bar = append(surface, $('.shortestpath-browser-tabs'));
		const list = append(bar, $('.shortestpath-browser-tab-list'));
		const tabs = titles.map(title => {
			const tab = append(list, $('.shortestpath-browser-tab'));
			append(tab, $('span.shortestpath-browser-tab-fill'));
			const label = append(tab, $('button.shortestpath-browser-tab-label'));
			label.textContent = title;
			append(tab, $('button.shortestpath-browser-tab-close'));
			return { tab, label };
		});
		append(bar, $('button.shortestpath-browser-tab-add'));
		return { list, tabs };
	}

	for (const fontSize of [13, 16, 20]) {
		test(`seven Chinese characters and separator fit at font size ${fontSize}`, () => {
			const { tabs } = createTabs(fontSize, 1000, ['最近宝藏距离', '入门 - 五个中文字', 'OJ']);
			assert.deepStrictEqual({
				titleFits: tabs[1].label.scrollWidth <= tabs[1].label.clientWidth,
				shortTitleIsCompact: tabs[2].tab.offsetWidth < tabs[1].tab.offsetWidth,
			}, { titleFits: true, shortTitleIsCompact: true });
		});
	}

	test('crowded tabs scroll while long titles stay bounded', () => {
		const { list, tabs } = createTabs(16, 350, ['入门 - 五个中文字', '进阶 - 五个中文字', '很长的网页标题'.repeat(10)]);
		assert.deepStrictEqual({
			titlesFit: tabs.slice(0, 2).every(({ label }) => label.scrollWidth <= label.clientWidth),
			stripScrolls: list.scrollWidth > list.clientWidth,
			longTitleIsBounded: tabs[2].tab.offsetWidth <= 280,
			longTitleOverflows: tabs[2].label.scrollWidth > tabs[2].label.clientWidth,
		}, { titlesFit: true, stripScrolls: true, longTitleIsBounded: true, longTitleOverflows: true });
	});
});
