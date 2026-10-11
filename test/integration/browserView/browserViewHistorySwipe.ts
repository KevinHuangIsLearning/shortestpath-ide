/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, BrowserWindow, WebContentsView } from 'electron';
// eslint-disable-next-line local/code-import-patterns
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
// eslint-disable-next-line local/code-import-patterns
import { registerBrowserViewHistorySwipe } from '../../../src/vs/platform/browserView/electron-main/browserViewHistorySwipe.js';

declare const HISTORY_SWIPE_TEST_PRELOAD: string;
declare const HISTORY_SWIPE_TEST_REPORT: string;

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
	const view = new WebContentsView({ webPreferences: { preload: HISTORY_SWIPE_TEST_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false } });
	win.contentView.addChildView(view);
	view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
	await win.loadURL('data:text/html,<!doctype html><html><body></body></html>');
	const contents = view.webContents;
	const navigations: string[] = [];
	let onPhase: (event: { phase: 'begin' | 'end' | 'cancel'; timestamp: number }) => void;
	const listener = registerBrowserViewHistorySwipe(contents, () => view.getVisible(), direction => {
		navigations.push(direction);
		const history = contents.navigationHistory;
		if (direction === 'back' && history.canGoBack()) {
			history.goBack();
		} else if (direction === 'forward' && history.canGoForward()) {
			history.goForward();
		}
	}, callback => { onPhase = callback; return { dispose() { } }; });
	try {
		await contents.loadURL(`http://127.0.0.1:${port}/first`);
		await contents.loadURL(`http://127.0.0.1:${port}/second`);
		// Simulated native begin/end signals and wheel callbacks, real Electron
		// isolated preload, DOM, IPC and navigation history. No physical input claim.
		const input = (type: Electron.InputEvent['type']) => {
			if (type === 'gestureScrollBegin' || type === 'gestureScrollEnd') {
				onPhase({ phase: type === 'gestureScrollBegin' ? 'begin' : 'end', timestamp: Date.now() });
			}
		};
		const begin = async () => {
			input('gestureScrollBegin');
			await delay(30);
		};
		const wheel = async (deltaX: number, deltaY = 0, target = '', prevented = false, trusted = true, control = false) => {
			input('mouseWheel');
			await contents.executeJavaScript(`__historySwipeTest.wheel(${JSON.stringify(deltaX)}, ${JSON.stringify(deltaY)}, ${JSON.stringify(target)}, ${prevented}, ${trusted}, ${control})`);
			await delay(110);
		};
		const end = async () => {
			input('gestureScrollEnd');
			await delay(80);
		};
		const hint = () => contents.executeJavaScript('__historySwipeTest.hint()');
		await begin();
		await wheel(-60);
		assert.deepStrictEqual(await hint(), { visible: true, opacity: '0.55', left: '-32px', right: 'auto', transform: '', sheets: 1 });
		await wheel(-70);
		assert.strictEqual((await hint()).opacity, '1');
		await delay(500);
		assert.deepStrictEqual(navigations, [], 'crossing the threshold and pausing does not navigate');
		assert.strictEqual((await hint()).visible, true, 'hint stays visible while fingers remain down');
		await wheel(60);
		await end();
		assert.deepStrictEqual(navigations, [], 'pulling back below the threshold cancels on release');
		assert.deepStrictEqual(await hint(), { visible: false });

		for (const args of [
			[0, 150, '', false, true, false],
			[-150, 0, 'scroll', false, true, false],
			[-150, 0, '', true, true, false],
			[-150, 0, '', false, false, false],
			[-150, 0, '', false, true, true],
		] as const) {
			await begin();
			await wheel(...args);
			await end();
			assert.deepStrictEqual([navigations, await hint()], [[], { visible: false }]);
		}
		await begin();
		await contents.executeJavaScript('document.body.style.overscrollBehaviorX = "contain"');
		await wheel(-150);
		await end();
		assert.deepStrictEqual(navigations, [], 'site scroll-chaining policy is preserved');
		await contents.executeJavaScript('document.body.style.overscrollBehaviorX = ""');

		await begin();
		await wheel(-150);
		assert.deepStrictEqual(navigations, []);
		await end();
		assert.ok(contents.getURL().endsWith('/first'), 'release goes back');
		assert.deepStrictEqual(await hint(), { visible: false });
		// Navigation replaced the preload. Momentum must not reopen its hint.
		await wheel(-150);
		assert.deepStrictEqual([navigations, await hint()], [['back'], { visible: false }]);

		await begin();
		await wheel(150);
		assert.deepStrictEqual(await hint(), { visible: true, opacity: '1', left: 'auto', right: '12px', transform: 'scaleX(-1)', sheets: 1 });
		assert.deepStrictEqual(navigations, ['back']);
		await end();
		assert.ok(contents.getURL().endsWith('/second'), 'release goes forward');
		assert.deepStrictEqual(navigations, ['back', 'forward']);

		await contents.loadURL(`http://127.0.0.1:${port}/strict`);
		await begin();
		await wheel(-150);
		assert.strictEqual((await hint()).opacity, '1', 'hint works under strict CSP');
		contents.emit('blur');
		await end();
		assert.deepStrictEqual([navigations, await hint()], [['back', 'forward'], { visible: false }]);

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
