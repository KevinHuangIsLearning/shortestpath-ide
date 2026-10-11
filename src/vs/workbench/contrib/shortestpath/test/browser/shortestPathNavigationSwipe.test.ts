/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../../browser/media/shortestPathMode.css';
import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { registerNavigationSwipe } from '../../browser/shortestPathNavigationSwipe.js';

suite('ShortestPath compact navigation swipe', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('horizontal distance supports continuous switching and ignores vertical scrolling and zoom', () => {
		const container = append(mainWindow.document.body, $('.compact-navigation'));
		store.add(toDisposable(() => container.remove()));
		const directions: number[] = [];
		store.add(registerNavigationSwipe(container, direction => directions.push(direction), []));
		const wheel = (deltaX: number, deltaY: number, time: number, ctrlKey = false) => {
			const event = new mainWindow.WheelEvent('wheel', { deltaX, deltaY, ctrlKey, bubbles: true, cancelable: true });
			Object.defineProperty(event, 'timeStamp', { value: time });
			container.dispatchEvent(event);
			return event.defaultPrevented;
		};
		assert.strictEqual(wheel(0, 100, 1000), false);
		assert.strictEqual(wheel(100, 0, 1000, true), false);
		assert.strictEqual(wheel(15, 0, 1100), true);
		assert.deepStrictEqual(directions, []);
		wheel(30, 0, 1120);
		wheel(100, 0, 1140);
		wheel(80, 0, 1300);
		assert.deepStrictEqual(directions, [1, 1, 1]);
		wheel(-45, 0, 1600);
		assert.deepStrictEqual(directions, [1, 1, 1, -1]);
		container.classList.remove('compact-navigation');
		assert.strictEqual(wheel(100, 0, 2000), false);
		assert.deepStrictEqual(directions, [1, 1, 1, -1]);
	});

	test('shared highlight follows hover and fractional gestures, then settles to the nearest page', async () => {
		const container = append(mainWindow.document.body, $('.compact-navigation'));
		container.style.cssText = 'position:relative;display:flex;gap:10px;width:100px;height:22px';
		store.add(toDisposable(() => container.remove()));
		const first = append(container, $('button', { 'aria-pressed': 'true' }));
		const second = append(container, $('button', { 'aria-pressed': 'false' }));
		for (const button of [first, second]) { button.style.cssText = 'flex:none;width:40px;height:22px'; }
		const directions: number[] = [];
		store.add(registerNavigationSwipe(container, direction => {
			directions.push(direction);
			first.setAttribute('aria-pressed', String(direction < 0));
			second.setAttribute('aria-pressed', String(direction > 0));
		}, [first, second]));
		const selection = container.lastElementChild as HTMLElement;
		const x = () => parseFloat(selection.style.transform.slice('translate('.length));
		second.dispatchEvent(new mainWindow.PointerEvent('pointerover', { bubbles: true }));
		assert.strictEqual(x(), 50);
		container.dispatchEvent(new mainWindow.PointerEvent('pointerleave'));
		assert.strictEqual(x(), 0);
		container.dispatchEvent(new mainWindow.WheelEvent('wheel', { deltaX: 10, cancelable: true }));
		assert.strictEqual(x(), 12.5);
		assert.strictEqual(selection.style.transition, 'none');
		assert.deepStrictEqual(directions, []);
		await timeout(160);
		assert.strictEqual(x(), 0);
		container.dispatchEvent(new mainWindow.WheelEvent('wheel', { deltaX: 25, cancelable: true }));
		assert.strictEqual(x(), 31.25);
		await timeout(160);
		assert.deepStrictEqual(directions, [1]);
		assert.strictEqual(x(), 50);
		assert.strictEqual(selection.style.transition, '');
	});

});
