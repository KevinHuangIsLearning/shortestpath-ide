/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, BrowserWindow, WebContentsView } from 'electron';
// eslint-disable-next-line local/code-import-patterns
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// eslint-disable-next-line local/code-import-patterns
import { registerBrowserViewHistorySwipe } from '../../../src/vs/platform/browserView/electron-main/browserViewHistorySwipe.js';

declare const HISTORY_SWIPE_TEST_PRELOAD: string;
declare const HISTORY_SWIPE_TEST_REPORT: string;
declare const HISTORY_SWIPE_TEST_NATIVE: string;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
app.disableHardwareAcceleration();
const server = http.createServer((req, res) => {
	res.setHeader('Content-Type', 'text/html');
	if (req.url === '/strict') {
		res.setHeader('Content-Security-Policy', `default-src 'none'; style-src 'none'; script-src 'none'`);
	}
	res.end('<!doctype html><html><body style="margin:0;height:2000px"><div id="scroll" style="position:fixed;top:0;left:0;width:200px;height:200px;overflow-x:auto"><div style="width:2000px;height:100px">scroll</div></div></body></html>');
});

async function run() {
	await app.whenReady();
	app.on('window-all-closed', () => { });
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as import('node:net').AddressInfo).port;
	const win = new BrowserWindow({ width: 800, height: 600, show: true });
	// Load the real addon in Electron to check its ABI, exports and cleanup.
	// This does not simulate or claim to validate physical AppKit recognition.
	const native = createRequire(__filename)(HISTORY_SWIPE_TEST_NATIVE) as {
		subscribe(callback: () => void): number;
		start(id: number, gesture: number, back: boolean, forward: boolean): void;
		cancel(id: number): void;
		unsubscribe(id: number): void;
		pointForWindow(handle: Buffer, window: number, x: number, y: number): { x: number; y: number } | undefined;
	};
	const subscription = native.subscribe(() => { });
	try {
		native.start(subscription, 0, true, true);
		native.cancel(subscription);
		assert.strictEqual(native.pointForWindow(win.getNativeWindowHandle(), -1, 0, 0), undefined);
	} finally {
		native.unsubscribe(subscription);
	}
	const view = new WebContentsView({ webPreferences: { preload: HISTORY_SWIPE_TEST_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false } });
	win.contentView.addChildView(view);
	view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
	await win.loadURL('data:text/html,<!doctype html><html><body></body></html>');
	const contents = view.webContents;
	const navigations: string[] = [];
	let onGesture: (event: { phase: 'begin' | 'update' | 'end' | 'cancel'; amount: number; x: number; y: number }) => void;
	let started: boolean[] | undefined;
	const listener = registerBrowserViewHistorySwipe(contents, () => view.getVisible(), direction => {
		navigations.push(direction);
		const history = contents.navigationHistory;
		if (direction === 'back' && history.canGoBack()) { history.goBack(); }
		else if (direction === 'forward' && history.canGoForward()) { history.goForward(); }
	}, callback => {
		onGesture = callback;
		return {
			start: (back, forward) => { started = [back, forward]; },
			cancel: () => { started = undefined; }, dispose() { },
		};
	});
	try {
		await contents.loadURL(`http://127.0.0.1:${port}/first`);
		await contents.loadURL(`http://127.0.0.1:${port}/second`);
		// Simulated AppKit callbacks, real isolated preload, DOM, IPC and history.
		// Physical tracking is intentionally left for a real trackpad check.
		const gesture = async (phase: 'begin' | 'update' | 'end' | 'cancel', amount = 0, x = 400, y = 300) => {
			onGesture({ phase, amount, x, y });
			await delay(80);
		};
		const begin = async (x = 400, y = 300) => {
			started = undefined;
			await gesture('begin', 0, x, y);
		};
		const hint = () => contents.executeJavaScript('__historySwipeTest.hint()');
		await begin();
		assert.deepStrictEqual(started, [true, false]);
		await gesture('update', 0.15);
		assert.deepStrictEqual(await hint(), { visible: true, opacity: '0.55', left: '-32px', right: 'auto', transform: '', sheets: 1 });
		await gesture('update', 0.4);
		await delay(500);
		assert.deepStrictEqual([navigations, (await hint()).opacity], [[], '1'], 'progress and pausing never navigate');
		await gesture('update', 0.1);
		await gesture('cancel');
		await gesture('end', 1);
		assert.deepStrictEqual([navigations, await hint()], [[], { visible: false }], 'system cancellation suppresses late animation callbacks');

		await contents.executeJavaScript('document.getElementById("scroll").scrollLeft = 100');
		await begin(100, 50);
		assert.strictEqual(started, undefined, 'scrollable content in the middle owns both directions');
		await gesture('end', 0.5);
		assert.deepStrictEqual(navigations, []);

		await contents.executeJavaScript('document.getElementById("scroll").scrollLeft = 0');
		await begin(100, 50);
		assert.deepStrictEqual(started, [true, false], 'outward swipe at the left edge can go back');
		await gesture('cancel');
		await contents.executeJavaScript('document.body.style.overscrollBehaviorX = "contain"');
		await begin();
		assert.strictEqual(started, undefined, 'site scroll-chaining policy is preserved');
		await contents.executeJavaScript('document.body.style.overscrollBehaviorX = ""');

		await begin();
		await gesture('update', 0.2);
		await contents.executeJavaScript('__historySwipeTest.wheel(-10, 0, "", true)');
		await gesture('end', 0.5);
		assert.deepStrictEqual([navigations, await hint()], [[], { visible: false }], 'page-handled wheel cancels navigation');

		await begin();
		await gesture('update', 0.2);
		await gesture('end', 0.2);
		assert.ok(contents.getURL().endsWith('/first'), 'AppKit successful release goes back even below the visual readiness threshold');
		await gesture('update', 1);
		await gesture('end', 1);
		assert.deepStrictEqual([navigations, await hint()], [['back'], { visible: false }], 'stale progress cannot affect the new document');

		await begin();
		assert.deepStrictEqual(started, [true, true], 'a backward swipe without history stays available to close the tab');
		await gesture('update', -0.4);
		assert.deepStrictEqual(await hint(), { visible: true, opacity: '1', left: 'auto', right: '12px', transform: 'scaleX(-1)', sheets: 1 });
		await gesture('end', -0.4);
		assert.ok(contents.getURL().endsWith('/second'), 'AppKit successful release goes forward');
		assert.deepStrictEqual(navigations, ['back', 'forward']);

		// A backward swipe on the first page has no history to consume, so it closes the tab.
		contents.navigationHistory.goBack();
		await delay(100);
		await begin();
		await gesture('update', 0.4);
		await gesture('end', 0.4);
		assert.deepStrictEqual(navigations, ['back', 'forward', 'close'], 'a backward swipe without history closes the tab');

		// Make both history directions available while checking directional edges.
		await contents.loadURL(`http://127.0.0.1:${port}/third`);
		contents.navigationHistory.goBack();
		await delay(100);
		await contents.executeJavaScript('document.getElementById("scroll").scrollLeft = 1800');
		await begin(100, 50);
		assert.deepStrictEqual(started, [false, true], 'right edge permits only forward navigation');
		await gesture('cancel');
		await contents.executeJavaScript('const scroll = document.getElementById("scroll"); scroll.style.direction = "rtl"; scroll.scrollLeft = 0');
		await begin(100, 50);
		assert.deepStrictEqual(started, [false, true], 'RTL right edge uses the same physical direction');
		await gesture('cancel');
		await contents.executeJavaScript('document.getElementById("scroll").scrollLeft = -1800');
		await begin(100, 50);
		assert.deepStrictEqual(started, [true, false], 'RTL left edge allows back');
		await gesture('cancel');

		await contents.executeJavaScript(`{
			const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:300px;top:0';
			const shadow = host.attachShadow({mode:'open'});
			shadow.innerHTML = '<div style="width:200px;height:100px;overflow-x:auto"><div style="width:1000px;height:100px"></div></div>';
			document.body.append(host); shadow.firstElementChild.scrollLeft = 100;
		}`);
		await begin(350, 50);
		assert.strictEqual(started, undefined, 'horizontal content in an open shadow root is preserved');
		await gesture('cancel');

		await contents.loadURL(`http://127.0.0.1:${port}/strict`);
		await begin();
		await gesture('update', 0.4);
		assert.strictEqual((await hint()).opacity, '1', 'hint works under strict CSP');
		contents.emit('blur');
		await gesture('end', 0.4);
		assert.deepStrictEqual([navigations, await hint()], [['back', 'forward', 'close'], { visible: false }]);

		console.log('Browser history swipe integration passed');
		writeFileSync(HISTORY_SWIPE_TEST_REPORT, 'passed');
	} finally {
		listener.dispose();
		contents.close();
		win.destroy();
		server.close();
	}
}

void run().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
