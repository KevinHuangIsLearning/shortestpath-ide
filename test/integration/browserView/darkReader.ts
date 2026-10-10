/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Run with npm run test-browser-dark-reader; uses the real Electron WebContentsView.
import { app, BrowserWindow, WebContentsView, session } from 'electron';
// eslint-disable-next-line local/code-import-patterns
import assert from 'node:assert/strict';
import http from 'node:http';
import { writeFileSync } from 'node:fs';
// Exercise the source controller directly in real Electron, without a workbench mock.
// eslint-disable-next-line local/code-import-patterns
import { BrowserViewDarkReader } from '../../../src/vs/platform/browserView/electron-main/browserViewDarkReader.js';

declare const DARK_READER_TEST_PRELOAD: string;
declare const DARK_READER_TEST_REPORT: string;
const preload = DARK_READER_TEST_PRELOAD;
const controllers: BrowserViewDarkReader[] = [];
const windows: BrowserWindow[] = [];
const servers: http.Server[] = [];
const failures: string[] = [];
let slowRequests = 0;
let slowCloses = 0;
const logService = { debug() { } };

async function serve(handler: http.RequestListener) {
	const server = http.createServer(handler);
	servers.push(server);
	await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
	return (server.address() as import('node:net').AddressInfo).port;
}

async function waitFor(contents: Electron.WebContents | Electron.WebFrameMain, expression: string, label: string) {
	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		if (await contents.executeJavaScript(expression)) {
			return;
		}
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	throw new Error(`Timed out: ${label}`);
}

async function waitForState(check: () => boolean, label: string): Promise<void> {
	const deadline = Date.now() + 5000;
	while (!check()) {
		if (Date.now() >= deadline) {
			throw new Error(`Timed out: ${label}`);
		}
		await new Promise(resolve => setTimeout(resolve, 20));
	}
}

const darkBody = `getComputedStyle(document.body).backgroundColor === 'rgb(24, 26, 27)'`;
const lightBody = `getComputedStyle(document.body).backgroundColor === 'rgb(255, 255, 255)'`;

async function run() {
	try {
		await app.whenReady();
		app.on('window-all-closed', () => { });
		const port = await serve((req, res) => {
			if (req.url?.startsWith('/slow.css')) {
				slowRequests++;
				res.setHeader('Content-Type', 'text/css');
				res.write('/* slow stylesheet */');
				const timer = setTimeout(() => res.end('body { background: white; }'), 15000);
				res.on('close', () => { clearTimeout(timer); slowCloses++; });
				return;
			}
			if (req.url === '/redirect.css') {
				res.writeHead(302, { Location: '/style.css' });
				res.end();
				return;
			}
			if (req.url === '/invalid-redirect.css') {
				res.writeHead(302, { Location: 'file:///etc/hosts' });
				res.end();
				return;
			}
			if (req.url === '/native.css') {
				res.setHeader('Content-Type', 'text/css');
				res.end('body { background: #121212; color: #eeeeee; min-height: 600px; }');
				return;
			}
			if (req.url === '/switch.css') {
				res.setHeader('Content-Type', 'text/css');
				res.end('body { background: white; color: black; min-height: 600px; } html.native-dark body { background: #121212; color: #eeeeee; }');
				return;
			}
			if (req.url === '/native' || req.url === '/switch' || req.url === '/late-dark') {
				res.setHeader('Content-Type', 'text/html');
				// eslint-disable-next-line local/code-no-unexternalized-strings
				res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'");
				const css = req.url === '/native' ? '/native.css' : '/switch.css';
				res.end(`<html><head><link rel="stylesheet" href="${css}"></head><body><h1>Native theme</h1><p>Readable content</p></body></html>`);
				return;
			}
			if (req.url === '/imported.css') {
				res.setHeader('Content-Type', 'text/css');
				res.end('.imported { background: white; color: black; }');
				return;
			}
			if (req.url === '/import-host.css') {
				res.setHeader('Content-Type', 'text/css');
				res.end('@import url(/imported.css);');
				return;
			}
			if (req.url === '/style.css') {
				res.setHeader('Content-Type', 'text/css');
				res.end('body { background: white; color: black; } .box { background: #eee; color: #111; }');
				return;
			}
			res.setHeader('Content-Type', 'text/html');
			res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' https://assets.darkreader.invalid; frame-src http://localhost:${port};`);
			res.end(`<html><head><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/import-host.css"><link rel="stylesheet" href="https://assets.darkreader.invalid/cdn.css"></head><body><h1>Dark Reader integration</h1><div class="box">Dynamic stylesheet</div><div class="cdn">Cross-origin stylesheet</div><div class="imported">Imported stylesheet</div><input value="editable"><pre>int main() { return 0; }</pre>${req.url === '/frame' ? '' : `<iframe src="http://localhost:${port}/frame"></iframe>`}</body></html>`);
		});

		for (const partition of ['persist:dark-reader-global-test', 'persist:dark-reader-workspace-test', 'dark-reader-ephemeral-test']) {
			const browserSession = session.fromPartition(partition);
			// A public HTTPS CDN origin, served locally without weakening CORS or CSP.
			// The official API deliberately rejects cross-origin HTTP/private hosts.
			browserSession.protocol.handle('https', request => {
				assert.equal(new URL(request.url).hostname, 'assets.darkreader.invalid');
				return new Response('.cdn { background: white; color: black; }', { headers: { 'Content-Type': 'text/css' } });
			});
			browserSession.registerPreloadScript({ type: 'frame', filePath: preload });
			const window = new BrowserWindow({ show: true, width: 940, height: 760 });
			windows.push(window);
			const view = new WebContentsView({ webPreferences: { session: browserSession, sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: true, backgroundThrottling: false } });
			window.contentView.addChildView(view);
			view.setVisible(true);
			view.setBounds({ x: 0, y: 0, width: 900, height: 700 });
			const contents = view.webContents;
			contents.on('console-message', event => {
				if (event.level === 'error' && !event.message.includes('Content Security Policy')) {
					failures.push(event.message);
				}
			});
			const controller = new BrowserViewDarkReader(contents, logService);
			controllers.push(controller);
			controller.setConfiguration({ enabled: false, excludedHosts: [] });
			await contents.loadURL(`http://127.0.0.1:${port}/`);
			await waitFor(contents, lightBody, 'original appearance');

			assert.equal(await contents.executeJavaScript(`typeof shortestPathDarkReaderBridge`), 'undefined');
			controller.setConfiguration({ enabled: true, excludedHosts: [] });
			await waitFor(contents, darkBody, 'dark body under strict CSP');
			await waitFor(contents, `Array.from(document.querySelectorAll('.darkreader--sync')).some(style => Array.from(style.sheet.cssRules).some(rule => rule.cssText.includes('.cdn')))`, 'CDN stylesheet actually parsed');
			await waitFor(contents, `Array.from(document.querySelectorAll('.darkreader--sync')).some(style => Array.from(style.sheet.cssRules).some(rule => rule.cssText.includes('.imported')))`, 'same-origin CSS import actually parsed under strict CSP');
			await waitFor(contents, `getComputedStyle(document.querySelector('.cdn')).backgroundColor === 'rgb(24, 26, 27)'`, 'cross-origin CSS');
			const frame = contents.mainFrame.framesInSubtree.find(frame => frame.url.includes('/frame'));
			assert.ok(frame, 'cross-origin frame exists');
			await waitFor(frame, darkBody, 'cross-origin iframe inherits top-level policy');
			await contents.executeJavaScript(`document.querySelector('input').value = 'still editable'; document.querySelector('input').dispatchEvent(new Event('input', {bubbles:true}));`);
			assert.equal(await contents.executeJavaScript(`document.querySelector('input').value`), 'still editable');
			await contents.executeJavaScript(`document.querySelector('link').sheet.insertRule('.box { background: white !important; color: black !important; }', document.querySelector('link').sheet.cssRules.length)`);
			await waitFor(contents, `getComputedStyle(document.querySelector('.box')).backgroundColor === 'rgb(24, 26, 27)'`, 'CSSOM insertRule');
			await contents.executeJavaScript(`const host = document.createElement('div'); host.id = 'shadow-host'; document.body.append(host); const root = host.attachShadow({mode:'open'}); const sheet = new CSSStyleSheet(); sheet.replaceSync('p { background: white; color: black; }'); root.adoptedStyleSheets = [sheet]; const p = document.createElement('p'); p.textContent = 'Shadow'; root.append(p);`);
			await waitFor(contents, `getComputedStyle(document.querySelector('#shadow-host').shadowRoot.querySelector('p')).backgroundColor === 'rgb(24, 26, 27)'`, 'new shadow root and adopted stylesheet');
			await contents.executeJavaScript(`const blockedScript = document.createElement('script'); blockedScript.textContent = 'window.cspWasBypassed = true'; document.head.append(blockedScript);`);
			assert.equal(await contents.executeJavaScript(`window.cspWasBypassed`), undefined, 'page CSP is unchanged');
			controller.setConfiguration({ enabled: true, excludedHosts: ['127.0.0.1'] });
			await waitFor(contents, lightBody, 'excluded host');
			await waitFor(frame, lightBody, 'iframe disabled with top-level host');
			controller.setConfiguration({ enabled: true, excludedHosts: [] });
			await waitFor(contents, darkBody, 'site re-enabled');
			await contents.executeJavaScript(`history.pushState({}, '', '/spa#section');`);
			controller.setConfiguration({ enabled: false, excludedHosts: [] });
			await waitFor(contents, lightBody, 'disable after SPA navigation');
			assert.equal(await contents.executeJavaScript(`document.querySelectorAll('.darkreader').length`), 0, 'disabled styles removed');
			assert.equal(await contents.executeJavaScript(`CSSStyleSheet.prototype.insertRule.toString().includes('[native code]')`), true, 'stylesheet proxy restored');
			controller.setConfiguration({ enabled: true, excludedHosts: [] });
			await waitFor(contents, darkBody, 're-enable after SPA navigation');
			await contents.loadURL(`http://localhost:${port}/second`);
			await waitFor(contents, darkBody, 'cross-origin navigation');
			controller.setConfiguration({ enabled: true, excludedHosts: ['localhost'] });
			await waitFor(contents, lightBody, 'new hostname exclusion');
			await contents.loadURL(`http://127.0.0.1:${port}/third`);
			await waitFor(contents, darkBody, 'exclusion does not bleed to other host');
			contents.reload();
			await new Promise(resolve => contents.once('did-finish-load', resolve));
			await waitFor(contents, darkBody, 'reload');
			for (let i = 0; i < 3; i++) {
				controller.setConfiguration({ enabled: false, excludedHosts: [] });
				await waitFor(contents, lightBody, 'repeated disable');
				controller.setConfiguration({ enabled: true, excludedHosts: [] });
				await waitFor(contents, darkBody, 'repeated enable');
			}
			assert.equal(await contents.executeJavaScript(`document.querySelectorAll('.darkreader--fallback').length`), 1, 'no duplicate injection');
			await contents.loadURL(`http://127.0.0.1:${port}/native`);
			const nativeDark = `document.querySelectorAll('.darkreader').length === 0 && getComputedStyle(document.body).backgroundColor === 'rgb(18, 18, 18)'`;
			await waitFor(contents, nativeDark, 'native dark theme remains original');
			controller.setConfiguration({ enabled: true, detectDarkTheme: false, excludedHosts: [] });
			await waitFor(contents, `document.querySelectorAll('.darkreader').length > 0`, 'detection can be disabled to force the engine');
			controller.setConfiguration({ enabled: true, detectDarkTheme: true, excludedHosts: [] });
			await waitFor(contents, nativeDark, 're-enabling detection removes engine styles');
			await contents.loadURL(`http://127.0.0.1:${port}/switch`);
			await waitFor(contents, darkBody, 'original light theme is converted');
			await contents.executeJavaScript(`document.documentElement.className = 'native-dark'`);
			await waitFor(contents, nativeDark, 'site switches to native dark');
			await contents.executeJavaScript(`document.documentElement.className = ''`);
			await waitFor(contents, darkBody, 'site switches back to light');
			await contents.loadURL(`http://127.0.0.1:${port}/late-dark`);
			await waitFor(contents, darkBody, 'light appearance before late stylesheet');
			await contents.executeJavaScript(`const late = document.createElement('link'); late.rel = 'stylesheet'; late.href = '/native.css'; document.head.append(late);`);
			await waitFor(contents, nativeDark, 'late native dark stylesheet');
			await contents.loadURL(`http://127.0.0.1:${port}/after-native`);
			await waitFor(contents, darkBody, 'native dark state does not leak across navigation');
			const fetchInWorld = (url: string) => contents.executeJavaScriptInIsolatedWorld(1001, [{ code: `shortestPathDarkReaderBridge.fetch(${JSON.stringify(url)}).then(resource => resource.body.byteLength)` }]);
			assert.ok(await fetchInWorld(`http://127.0.0.1:${port}/redirect.css`) > 0, 'HTTP redirect is followed');
			assert.equal(await fetchInWorld(`http://127.0.0.1:${port}/invalid-redirect.css`), 0, 'non-HTTP redirect is rejected');
			assert.equal(await fetchInWorld(`http://127.0.0.1:${port}/`), 0, 'HTML response cannot be read through the resource bridge');
			const startSlowRequest = async () => {
				const previous = slowRequests;
				await contents.executeJavaScriptInIsolatedWorld(1001, [{ code: `void shortestPathDarkReaderBridge.fetch(location.origin + '/slow.css?' + Date.now()); true;` }]);
				await waitForState(() => slowRequests > previous, 'slow CSS request started');
			};
			await startSlowRequest();
			let previousCloses = slowCloses;
			controller.setConfiguration({ enabled: false, excludedHosts: [] });
			await waitForState(() => slowCloses > previousCloses, 'disable aborts network response');
			controller.setConfiguration({ enabled: true, excludedHosts: [] });
			await waitFor(contents, darkBody, 'enabled before navigation cancellation');
			await startSlowRequest();
			previousCloses = slowCloses;
			await contents.loadURL(`http://127.0.0.1:${port}/after-slow`);
			await waitForState(() => slowCloses > previousCloses, 'navigation aborts old document response');
			await waitFor(contents, darkBody, 'new document ready');
			await startSlowRequest();
			previousCloses = slowCloses;
			controller.dispose();
			await waitForState(() => slowCloses > previousCloses, 'dispose aborts network response');
			await contents.loadURL('about:blank');
			assert.equal(await contents.executeJavaScript(`document.querySelectorAll('.darkreader').length`), 0, 'special URL untouched');
			controller.dispose();
			contents.close();
			window.destroy();
			console.log(`PASS ${partition}: strict CSP, CDN CSS, OOPIF, CSSOM, Shadow DOM, native dark detection, site theme switching, late styles, force override, input, page CSP, site exclusion, SPA, navigation, reload, repeated toggles, request validation/cancellation, cleanup`);
		}
		assert.deepEqual(failures, [], 'no engine/preload errors');
		writeFileSync(DARK_READER_TEST_REPORT, '3 partitions passed');
		console.log('Dark Reader Electron integration passed');
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	} finally {
		for (const controller of controllers) {
			controller.dispose();
		}
		for (const window of windows) {
			if (!window.isDestroyed()) {
				window.destroy();
			}
		}
		for (const server of servers) {
			server.closeAllConnections();
			server.close();
		}
		app.exit(process.exitCode ?? 0);
	}
}

void run();
