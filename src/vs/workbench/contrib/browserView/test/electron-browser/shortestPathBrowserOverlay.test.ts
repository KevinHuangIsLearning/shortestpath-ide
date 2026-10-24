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
		style.textContent = '.monaco-workbench { position: relative; width: 800px; height: 600px; background: rgb(1, 2, 3); } .monaco-workbench.border:not(.fullscreen) { border: 1px solid rgb(4, 5, 6); } .monaco-workbench.border.mac.macos-tahoe { border-radius: 16px; } .notifications-toasts { position: absolute; right: 10px; bottom: 10px; width: 200px; height: 80px; display: none; } .notifications-toasts.visible { display: block; }';
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

	test('problem import hints float above native pages with live dismiss controls and leave no orphan on disposal', async () => {
		toasts.classList.remove('visible');
		const hint = workbench.appendChild($('.browser-problem-import-hint.visible'));
		hint.style.cssText = 'position:absolute;left:450px;top:40px;width:300px;height:100px';
		const dismiss = hint.appendChild($('button'));
		dismiss.addEventListener('click', () => { hint.classList.remove('visible'); hint.hidden = true; });
		overlay.setVisible(workbench, true);
		await settle();
		assert.deepStrictEqual({ portaled: hint.ownerDocument === target.document, bounds: layouts.at(-1) }, {
			portaled: true, bounds: { x: 442, y: 32, width: 316, height: 116, viewportWidth: 800, viewportHeight: 600, zoomFactor: 1 }
		});
		dismiss.click();
		await settle();
		assert.strictEqual(layouts.at(-1), undefined);
		hint.remove();
		await settle();
		overlay.dispose();
		assert.strictEqual(hint.isConnected, false);
	});

	test('keeps the native notification host transparent without cloned workbench chrome', async () => {
		workbench.classList.add('border', 'mac', 'macos-tahoe');
		workbench.style.setProperty('background-color', 'rgb(7, 8, 9)', 'important');
		source.document.documentElement.style.setProperty('background-color', 'rgb(10, 11, 12)', 'important');
		overlay.setVisible(workbench, true);
		await settle();
		source.document.documentElement.style.setProperty('background', 'rgb(13, 14, 15)', 'important');
		await settle();
		const root = target.document.querySelector<HTMLElement>('.monaco-workbench')!;
		const rootStyle = target.getComputedStyle(root);
		assert.deepStrictEqual({
			rootClasses: root.className,
			rootBackground: rootStyle.backgroundColor,
			rootBorder: rootStyle.borderBottomWidth,
			rootRadius: rootStyle.borderRadius,
			htmlBackground: target.document.documentElement.style.getPropertyValue('background'),
			htmlBackgroundPriority: target.document.documentElement.style.getPropertyPriority('background'),
			bodyBackground: target.document.body.style.getPropertyValue('background'),
			bodyBackgroundPriority: target.document.body.style.getPropertyPriority('background'),
		}, {
			rootClasses: 'monaco-workbench mac macos-tahoe',
			rootBackground: 'rgba(0, 0, 0, 0)',
			rootBorder: '0px',
			rootRadius: '0px',
			htmlBackground: 'transparent',
			htmlBackgroundPriority: 'important',
			bodyBackground: 'transparent',
			bodyBackgroundPriority: 'important',
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

	test('navigation labels use separate stable bounds and keep source lifecycle while notifications stay visible', async () => {
		overlay.setVisible(workbench, true);
		await settle();
		const notificationLayout = layouts.at(-1);
		const frame = source.document.createElement('iframe');
		frame.style.cssText = 'width: 800px; height: 600px;';
		source.document.body.appendChild(frame);
		store.add(toDisposable(() => frame.remove()));
		const navigationTarget = frame.contentWindow!;
		const navigationLayouts: (IShortestPathBrowserOverlayLayout | undefined)[] = [];
		const navigation = store.add(new ShortestPathBrowserOverlay(source, {
			open: () => navigationTarget,
			layout: async layout => { navigationLayouts.push(layout); }
		}, new NullLogService(), 'navigation'));
		navigation.setVisible(workbench, true);
		await settle();
		const idle = navigationLayouts.length;
		const context = workbench.appendChild($('.context-view'));
		context.style.cssText = 'position: absolute; left: 60px; top: 140px;';
		const hover = context.appendChild($('.monaco-hover.shortestpath-navigation-hover'));
		hover.style.cssText = 'width: 100px; height: 40px;';
		hover.textContent = '代码片段';
		await settle();
		const open = navigationLayouts.at(-1);
		const count = navigationLayouts.length;
		await settle();
		const state = {
			open, idle, stable: count === navigationLayouts.length,
			text: navigationTarget.document.querySelector('.shortestpath-navigation-hover')?.textContent,
			sourceRetained: hover.ownerDocument === source.document,
			notificationLayout: layouts.at(-1), notificationRetained: toasts.ownerDocument === target.document
		};
		context.remove();
		await settle();
		assert.deepStrictEqual({ ...state, closed: navigationLayouts.at(-1), removed: navigationTarget.document.querySelector('.shortestpath-navigation-hover') }, {
			open: { x: 52, y: 132, width: 116, height: 56, viewportWidth: 800, viewportHeight: 600, zoomFactor: 1 },
			idle: 0, stable: true, text: '代码片段', sourceRetained: true, notificationLayout, notificationRetained: true,
			closed: undefined, removed: null
		});
	});

	for (const zoom of [0.8, 1.25, 1.5]) {
		test(`navigation mirror stays aligned at CSS zoom ${zoom} and updates when its label moves`, async () => {
			workbench.style.zoom = String(zoom);
			const navigation = store.add(new ShortestPathBrowserOverlay(source, {
				open: () => target,
				layout: async layout => { layouts.push(layout); }
			}, new NullLogService(), 'navigation'));
			const context = workbench.appendChild($('.context-view'));
			context.style.cssText = 'position: absolute; left: 60px; top: 140px;';
			const hover = context.appendChild($('.monaco-hover.shortestpath-navigation-hover'));
			hover.style.cssText = 'width: 100px; height: 40px;';
			hover.textContent = '浏览';
			navigation.setVisible(workbench, true);
			await settle();
			const initial = layouts.at(-1);
			const count = layouts.length;
			await settle();
			const stable = count === layouts.length;
			context.style.top = '240px';
			hover.textContent = '设置';
			await settle();
			assert.deepStrictEqual({ initial, stable, moved: layouts.at(-1), text: target.document.querySelector('.shortestpath-navigation-hover')?.textContent }, {
				initial: { x: Math.floor(60 * zoom - 8), y: Math.floor(140 * zoom - 8), width: 100 * zoom + 16, height: 40 * zoom + 16, viewportWidth: 800, viewportHeight: 600, zoomFactor: 1 },
				stable: true,
				moved: { x: Math.floor(60 * zoom - 8), y: Math.floor(240 * zoom - 8), width: 100 * zoom + 16, height: 40 * zoom + 16, viewportWidth: 800, viewportHeight: 600, zoomFactor: 1 }, text: '设置'
			});
		});
	}

	test('navigation mirrors retain the original appearance, language and stylesheets loaded after opening', async () => {
		source.document.documentElement.lang = 'zh-CN';
		const fonts = source.document.head.appendChild($('style'));
		fonts.textContent = 'html:lang(zh-CN) .monaco-workbench { font-family: "PingFang SC", sans-serif; }';
		const context = workbench.appendChild($('.context-view'));
		context.style.cssText = 'position: absolute; left: 60px; top: 140px;';
		const hover = context.appendChild($('.monaco-hover.workbench-hover.compact.shortestpath-navigation-hover'));
		const contents = hover.appendChild($('.hover-contents'));
		contents.textContent = '代码片段';
		const navigation = store.add(new ShortestPathBrowserOverlay(source, {
			open: () => target,
			layout: async layout => { layouts.push(layout); }
		}, new NullLogService(), 'navigation'));
		navigation.setVisible(workbench, true);
		await settle();

		const stylesheet = source.document.createElement('link');
		stylesheet.rel = 'stylesheet';
		stylesheet.href = new URL('../../../shortestpath/browser/media/shortestPathMode.css', import.meta.url).href;
		const loaded = new Promise<void>((resolve, reject) => {
			stylesheet.onload = () => resolve();
			stylesheet.onerror = () => reject(new Error('Navigation stylesheet failed to load'));
		});
		source.document.head.appendChild(stylesheet);
		await loaded;
		await settle();
		const mirror = target.document.querySelector<HTMLElement>('.shortestpath-navigation-hover')!;
		const mirrorContents = mirror.querySelector<HTMLElement>('.hover-contents')!;
		function appearance(window: Window, element: HTMLElement) {
			const style = window.getComputedStyle(element);
			return { background: style.backgroundColor, color: style.color, radius: style.borderRadius, shadow: style.boxShadow, padding: style.padding, font: style.font };
		}
		const original = { hover: appearance(source, hover), contents: appearance(source, contents) };
		assert.deepStrictEqual({ language: target.document.documentElement.lang, background: original.hover.background, mirrored: { hover: appearance(target, mirror), contents: appearance(target, mirrorContents) } }, {
			language: 'zh-CN', background: 'rgb(53, 54, 61)', mirrored: original
		});

		stylesheet.remove();
		fonts.textContent = 'html:lang(en) .monaco-workbench { font-family: monospace; }';
		source.document.documentElement.lang = 'en';
		await settle();
		assert.deepStrictEqual({ language: target.document.documentElement.lang, hover: appearance(target, mirror), contents: appearance(target, mirrorContents) }, {
			language: 'en', hover: appearance(source, hover), contents: appearance(source, contents)
		});
	});
});
