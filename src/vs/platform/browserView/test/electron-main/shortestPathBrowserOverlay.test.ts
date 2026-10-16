/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { EventEmitter } from 'events';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { validatedIpcMain } from '../../../../base/parts/ipc/electron-main/ipcMain.js';
import { IShortestPathBrowserOverlayEnvironment, ShortestPathBrowserOverlayWindows } from '../../electron-main/shortestPathBrowserOverlay.js';

suite('Native browser notification overlays', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let handler: Parameters<typeof validatedIpcMain.handle>[1];
	let owner: Electron.WebContents;
	let contents: Electron.WebContents;
	let view: Electron.WebContentsView;
	let window: Electron.BrowserWindow;
	let manager: ShortestPathBrowserOverlayWindows;
	let attached: Electron.View[];
	let visible: boolean[];
	let bounds: Electron.Rectangle[];
	let zoom: number[];
	let removed: Electron.View[];

	setup(() => {
		attached = [];
		visible = [];
		bounds = [];
		zoom = [];
		removed = [];
		owner = Object.assign(new EventEmitter(), { id: 100, mainFrame: new class extends mock<Electron.WebFrameMain>() { } }) as unknown as Electron.WebContents;
		let destroyed = false;
		contents = Object.assign(new EventEmitter(), {
			id: 101,
			isDestroyed: () => destroyed,
			close: () => { destroyed = true; contents.emit('destroyed'); },
			setWindowOpenHandler: () => { },
			setZoomFactor: (value: number) => zoom.push(value),
		}) as unknown as Electron.WebContents;
		view = new class extends mock<Electron.WebContentsView>() {
			override readonly webContents = contents;
			override setBounds(value: Electron.Rectangle) { bounds.push(value); }
			override setVisible(value: boolean) { visible.push(value); }
			override setBackgroundColor() { }
		};
		window = new class extends mock<Electron.BrowserWindow>() {
			override isDestroyed() { return false; }
			override contentView = new class extends mock<Electron.View>() {
				override addChildView(child: Electron.View) { attached.push(child); }
				override removeChildView(child: Electron.View) { removed.push(child); }
			};
		};
		const environment: IShortestPathBrowserOverlayEnvironment = {
			ipc: new class extends mock<typeof validatedIpcMain>() {
				override handle(_channel: string, callback: Parameters<typeof validatedIpcMain.handle>[1]) { handler = callback; return this; }
				override removeHandler() { return this; }
			},
			getWindow: () => window,
			getOpener: () => owner,
			createView: () => view,
		};
		manager = store.add(new ShortestPathBrowserOverlayWindows(environment));
	});

	function event(sender = owner, frame = owner.mainFrame): Electron.IpcMainInvokeEvent {
		return new class extends mock<Electron.IpcMainInvokeEvent>() {
			override readonly sender = sender;
			override readonly senderFrame = frame;
		};
	}

	function create(): void {
		const response = manager.createWindowOpenHandler(owner);
		assert.strictEqual(manager.isOverlay(contents), true);
		response.createWindow!({});
		assert.strictEqual(manager.isOverlay(contents), false);
	}

	test('raises only the notification view and rounds its bounds at fractional zoom', async () => {
		create();
		await handler(event(), { x: 100.25, y: 200.25, width: 300.5, height: 100.5, viewportWidth: 900, viewportHeight: 600, zoomFactor: 1.25 });
		await handler(event(), undefined);
		assert.deepStrictEqual({ bounds, visible, zoom, attached }, {
			bounds: [{ x: 125, y: 250, width: 376, height: 126 }],
			visible: [false, true, false], zoom: [1.25], attached: [view, view],
		});
	});

	test('rejects another sender, subframes and invalid bounds', async () => {
		create();
		const layout = { x: 0, y: 0, width: 200, height: 100, viewportWidth: 900, viewportHeight: 600, zoomFactor: 1 };
		await assert.rejects(handler(event(contents), layout), /Unknown browser overlay owner/);
		await assert.rejects(handler(event(owner, new class extends mock<Electron.WebFrameMain>() { }), layout), /Unknown browser overlay owner/);
		await assert.rejects(handler(event(), { ...layout, width: NaN }), /Invalid browser overlay bounds/);
		assert.deepStrictEqual(bounds, []);
	});

	test('navigation and notification views have independent bounds and visibility for the same owner', async () => {
		create();
		const notificationView = view;
		const navigationBounds: Electron.Rectangle[] = [];
		const navigationVisibility: boolean[] = [];
		const navigationContents = Object.assign(new EventEmitter(), {
			isDestroyed: () => false, close: () => { }, setWindowOpenHandler: () => { }, setZoomFactor: () => { },
		}) as unknown as Electron.WebContents;
		view = new class extends mock<Electron.WebContentsView>() {
			override readonly webContents = navigationContents;
			override setBounds(value: Electron.Rectangle) { navigationBounds.push(value); }
			override setVisible(value: boolean) { navigationVisibility.push(value); }
			override setBackgroundColor() { }
		};
		manager.createWindowOpenHandler(owner, 'navigation').createWindow!({});
		const layout = { x: 500, y: 400, width: 200, height: 100, viewportWidth: 900, viewportHeight: 600, zoomFactor: 1 };
		await handler(event(), layout);
		await handler(event(), { ...layout, x: 60, y: 140, width: 100, height: 40 }, 'navigation');
		await handler(event(), undefined, 'navigation');
		await assert.rejects(handler(event(), layout, 'unknown'), /Unknown browser overlay owner/);
		assert.deepStrictEqual({ bounds, visible, navigationBounds, navigationVisibility, attached }, {
			bounds: [{ x: 500, y: 400, width: 200, height: 100 }], visible: [false, true],
			navigationBounds: [{ x: 60, y: 140, width: 100, height: 40 }], navigationVisibility: [false, true, false],
			attached: [notificationView, view, notificationView, view],
		});
	});

	test('cleans up on owner navigation and permits a new overlay afterward', () => {
		create();
		assert.strictEqual(manager.createWindowOpenHandler(owner).action, 'deny');
		owner.emit('did-start-navigation', {}, 'https://example.com', false, false);
		assert.deepStrictEqual(removed, []);
		owner.emit('did-start-navigation', {}, 'https://example.com', false, true);
		assert.deepStrictEqual(removed, [view]);
		assert.strictEqual(manager.createWindowOpenHandler(owner).action, 'allow');
	});
});
