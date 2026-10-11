/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, getWindows, getWindowById, onDidRegisterWindow, registerWindow, scheduleAtNextAnimationFrame } from '../../../../../base/browser/dom.js';
import { CodeWindow, ensureCodeWindow, mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { timeout } from '../../../../../base/common/async.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { IShortestPathBrowserOverlayLayout, ShortestPathBrowserOverlay } from '../../electron-browser/shortestPathBrowserOverlay.js';

suite('Live browser notification portal', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let source: CodeWindow;
	let target: Window;
	let workbench: HTMLElement;
	let toasts: HTMLElement;
	let button: HTMLButtonElement;
	let overlay: ShortestPathBrowserOverlay;
	let layouts: (IShortestPathBrowserOverlayLayout | undefined)[];

	setup(() => {
		const frames = [0, 1].map(() => {
			const frame = mainWindow.document.createElement('iframe');
			frame.style.cssText = 'width: 800px; height: 600px; position: absolute; top: 0; left: 0;';
			mainWindow.document.body.appendChild(frame);
			store.add(toDisposable(() => frame.remove()));
			return frame;
		});
		source = frames[0].contentWindow! as CodeWindow;
		target = frames[1].contentWindow!;
		ensureCodeWindow(source, 1001);
		store.add(registerWindow(source));
		const style = source.document.head.appendChild($('style'));
		style.textContent = '.monaco-workbench { position: relative; width: 800px; height: 600px; } .notifications-toasts { position: absolute; right: 10px; bottom: 10px; width: 200px; height: 80px; display: none; } .notifications-toasts.visible { display: block; }';
		workbench = source.document.body.appendChild($('.monaco-workbench'));
		toasts = workbench.appendChild($('.notifications-toasts.visible'));
		button = toasts.appendChild($('button')) as HTMLButtonElement;
		button.textContent = 'Test';
		layouts = [];
		overlay = store.add(new ShortestPathBrowserOverlay(source, {
			open: () => target,
			layout: async layout => { layouts.push(layout); }
		}, new NullLogService()));
	});

	async function settle(): Promise<void> {
		await timeout(100);
	}

	test('keeps the live button, host dimensions and stable native bounds; restores nodes on disposal', async () => {
		let clicks = 0;
		button.addEventListener('click', () => clicks++);
		overlay.setVisible(workbench, true);
		await settle();
		button.click();
		const count = layouts.length;
		await settle();
		const state = { target: button.ownerDocument === target.document, clicks, layout: layouts.at(-1), stable: layouts.length === count };
		overlay.dispose();
		assert.deepStrictEqual({ ...state, restored: toasts.parentElement === workbench }, {
			target: true, clicks: 1, stable: true, restored: true,
			layout: { x: 582, y: 502, width: 216, height: 96, viewportWidth: 800, viewportHeight: 600, zoomFactor: 1 }
		});
	});

	test('registers the child document for focus and keyboard listeners while retaining host routing', async () => {
		let registered = false;
		store.add(onDidRegisterWindow(({ window, disposables }) => {
			if (window !== target) { return; }
			registered = true;
			// Existing keybinding services install both down/up listeners through this event.
			disposables.add(toDisposable(() => { registered = false; }));
		}));
		overlay.setVisible(workbench, true);
		await settle();
		button.focus();
		assert.deepStrictEqual({ registered, document: [...getWindows()].some(entry => entry.window === target), element: target.document.activeElement === button, routing: getWindowById(source.vscodeWindowId)?.window === source }, {
			registered: true, document: true, element: true, routing: true
		});
		overlay.dispose();
		assert.strictEqual(registered, false);
	});

	test('restores notifications beneath command palettes even with a separate visible browser', async () => {
		overlay.setVisible(workbench, true);
		await settle();
		const palette = workbench.appendChild($('.quick-input-widget'));
		palette.style.cssText = 'position: absolute; right: 0; bottom: 0; width: 300px; height: 60px;';
		await settle();
		assert.deepStrictEqual({ restored: toasts.parentElement === workbench, hidden: layouts.at(-1) }, { restored: true, hidden: undefined });
		palette.remove();
		await settle();
		assert.strictEqual(toasts.ownerDocument, target.document);
		overlay.setVisible(workbench, false);
		await settle();
		assert.deepStrictEqual({ restored: toasts.parentElement === workbench, hidden: layouts.at(-1) }, { restored: true, hidden: undefined });
	});

	test('keeps unrelated editor hovers from pulling notifications behind the page', async () => {
		overlay.setVisible(workbench, true);
		await settle();
		const hover = workbench.appendChild($('.monaco-hover'));
		hover.style.cssText = 'position: absolute; left: 0; top: 0; width: 200px; height: 100px;';
		await settle();
		assert.strictEqual(toasts.ownerDocument, target.document);
	});

	test('runs host animation tasks after a child view is hidden and disposed', async () => {
		overlay.setVisible(workbench, true);
		await settle();
		const calls: string[] = [];
		store.add(scheduleAtNextAnimationFrame(target, () => calls.push('child')));
		overlay.setVisible(workbench, false);
		overlay.dispose();
		store.add(scheduleAtNextAnimationFrame(source, () => calls.push('host')));
		await settle();
		assert.deepStrictEqual(calls, ['child', 'host']);
	});

	test('expands the native bounds for a notification tooltip and shrinks after it closes', async () => {
		overlay.setVisible(workbench, true);
		await settle();
		const normal = layouts.at(-1)!;
		const hover = toasts.parentElement!.appendChild($('.monaco-hover'));
		hover.style.cssText = 'position: absolute; left: 590px; top: 350px; width: 200px; height: 140px;';
		await settle();
		const expanded = layouts.at(-1)!;
		hover.remove();
		await settle();
		assert.deepStrictEqual({ expanded, restored: layouts.at(-1) }, {
			expanded: { ...normal, y: 342, height: 256 }, restored: normal
		});
	});
});
