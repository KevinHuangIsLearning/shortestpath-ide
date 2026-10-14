/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../../browser/media/shortestPathMode.css';
import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { HoverService } from '../../../../../platform/hover/browser/hoverService.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { createNavigationHoverDelegate } from '../../browser/shortestPathNavigationHover.js';

suite('ShortestPath navigation hover', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setupHover(buttonTop: number, pageTop: number, zoom = 1) {
		const fixture = append(mainWindow.document.body, $('.monaco-workbench'));
		Object.assign(fixture.style, { position: 'absolute', left: '0', top: '0', width: '1000px', height: '1000px', zoom: String(zoom) });
		store.add(toDisposable(() => fixture.remove()));
		const button = append(fixture, $('button'));
		Object.assign(button.style, { position: 'absolute', left: '6px', top: `${buttonTop}px`, width: '44px', height: '44px' });
		const page = append(fixture, $('.shortestpath-browser-page'));
		Object.assign(page.style, { position: 'absolute', left: '60px', top: `${pageTop}px`, width: '800px', height: '600px' });
		const instantiation = workbenchInstantiationService(undefined, store);
		instantiation.stub(ILayoutService, { activeContainer: fixture, mainContainer: fixture, getContainer: () => fixture, onDidLayoutContainer: Event.None });
		const hoverService = store.add(instantiation.createInstance(HoverService));
		return { button, page, fixture, hoverService };
	}

	for (const { name, buttonTop, pageTop, zoom, label } of [
		{ name: 'snippets', buttonTop: 147, pageTop: 123, zoom: 1, label: '代码片段' },
		{ name: 'settings at the bottom', buttonTop: 942, pageTop: 123, zoom: 1, label: '设置' },
		{ name: 'first button in fullscreen', buttonTop: 6, pageTop: 88, zoom: 1, label: '浏览' },
		{ name: 'first button in fullscreen with compact tabs', buttonTop: 6, pageTop: 80, zoom: 1, label: '浏览' },
		{ name: 'zoomed snippets', buttonTop: 147, pageTop: 123, zoom: 1.25, label: 'Code Snippets' },
		{ name: 'zoomed fullscreen first button', buttonTop: 6, pageTop: 88, zoom: 1.25, label: '浏览' },
		{ name: 'zoomed fullscreen first button with compact tabs', buttonTop: 6, pageTop: 80, zoom: 1.5, label: '浏览' },
		{ name: 'zoomed out snippets', buttonTop: 147, pageTop: 123, zoom: 0.8, label: '代码片段' }
	]) {
		test(`${name} tooltip stays beside its own button`, () => {
			const { button, fixture, hoverService } = setupHover(buttonTop, pageTop, zoom);
			const delegate = createNavigationHoverDelegate(hoverService);
			const hover = delegate.showHover({ target: button, content: label });
			assert.ok(hover);
			store.add(hover);
			const tooltip = fixture.querySelector<HTMLElement>('.shortestpath-navigation-hover')!;
			assert.deepStrictEqual({
				text: tooltip.textContent,
				readable: tooltip.clientHeight >= 30,
				besideButton: tooltip.getBoundingClientRect().left >= button.getBoundingClientRect().right,
				alignedWithButton: tooltip.getBoundingClientRect().top < button.getBoundingClientRect().bottom && tooltip.getBoundingClientRect().bottom > button.getBoundingClientRect().top
			}, { text: label, readable: true, besideButton: true, alignedWithButton: true });
		});
	}

	test('managed mouse hover stays beside the button and closes when the pointer leaves', async () => {
		const { button, fixture, hoverService } = setupHover(147, 123);
		const delegate = createNavigationHoverDelegate(hoverService);
		store.add(hoverService.setupManagedHover(delegate, button, '代码片段'));
		button.dispatchEvent(new mainWindow.MouseEvent('mouseover', { bubbles: true }));
		await timeout(150);
		const tooltip = fixture.querySelector<HTMLElement>('.shortestpath-navigation-hover');
		assert.ok(tooltip);
		assert.strictEqual(tooltip.getBoundingClientRect().left >= button.getBoundingClientRect().right, true);
		button.dispatchEvent(new mainWindow.MouseEvent('mouseover', { bubbles: true }));
		button.dispatchEvent(new mainWindow.MouseEvent('mouseleave', { relatedTarget: fixture }));
		await timeout(250);
		assert.strictEqual(fixture.querySelector('.shortestpath-navigation-hover'), null);
	});

});
