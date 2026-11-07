/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, access, readFile, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createHomepageServer } = require('./server.cjs');
const post = async (origin, route, body = {}) => fetch(origin + route, { method: 'POST', headers: { 'X-ShortestPath-Homepage': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('IDE owns Home and fills placeholders, CSS, and commands through the local bridge', async t => {
	const vm = require('node:vm');
	const dataDir = await mkdtemp(path.join(tmpdir(), 'homepage-command-'));
	const callbacks = new Map(), subscriptions = [], calls = [];
	let starts = 0, closed;
	let featureEnabled = false, refreshFeatures;
	const stopped = new Promise(resolve => { closed = resolve; });
	const moduleExports = {};
	const event = () => ({ dispose() {} });
	vm.runInNewContext(await readFile(path.join(__dirname, '../out/homepage.js'), 'utf8'), {
		exports: moduleExports, console, process: { env: {} },
		setInterval: (callback, ms) => { assert.equal(ms, 12 * 60 * 60_000); refreshFeatures = callback; return { unref() {} }; },
		clearInterval() {},
		require: id => {
			if (id === './featureConfiguration') {return { fetchFeatureConfiguration: async urls => {
				assert.match(urls[0], /raw\.githubusercontent\.com\/.*\/remote_configurations\/configurations\/features\.json$/);
				assert.match(urls[1], /raw\.gitcode\.com\/.*\/remote_configurations\/configurations\/features\.json$/);
				return { homepage: featureEnabled };
			} };}
			if (id === './localization') {return { localize: value => value };}
			if (id === 'vscode') {return {
				commands: {
					getCommands: async () => ['workbench.action.files.newUntitledFile'],
					registerCommand: (name, run) => { callbacks.set(name, run); return { dispose() {} }; },
					executeCommand: async (...args) => {
						calls.push(args);
						if (args[0] === 'shortestpath.homepage.getContext') {return { recent: [{ name: 'actual-project', uri: 'file:///training' }], favorites: [{ name: 'AtCoder', url: 'https://atcoder.jp/' }] };}
						if (args[0] === 'judger.getHomepageHeatmap') {return { days: [{ date: '2026-11-01', count: 2 }], skipped: 0 };}
						if (args[0] === 'shortestpath.homepage.getTheme') {return ':root{--vscode-editor-background:#123456}';}
					},
				},
				window: { onDidChangeActiveColorTheme: event },
				workspace: { getConfiguration: () => ({ get: (key, fallback) => fallback }), onDidChangeWorkspaceFolders: event, onDidSaveTextDocument: event, onDidChangeConfiguration: event },
				env: { language: 'zh-cn' },
			};}
			if (id.endsWith('server.cjs')) {return { createHomepageServer: async options => {
				assert.equal(options.sourceUrl, 'https://raw.githubusercontent.com/KevinHuangIsLearning/shortestpath-ide/main/remote_configurations/homepage/index.html');
				assert.equal(options.fallbackSourceUrl, 'https://raw.gitcode.com/KevinHuangIsLearning/shortestpath-ide/raw/main/remote_configurations/homepage/index.html');
				starts++; const server = await createHomepageServer({ ...options, sourceUrl: '', fallbackSourceUrl: '' });
				return { listen: port => server.listen(port), close: async () => { await server.close(); closed(); } };
			} };}
			return require(id);
		},
	});
	moduleExports.registerHomepage({ globalStorageUri: { fsPath: dataDir }, subscriptions });
	t.after(async () => { subscriptions.forEach(item => item.dispose()); if (starts) {await stopped;} await rm(dataDir, { recursive: true, force: true }); });
	assert.equal(await callbacks.get('shortestpath.homepage.isEnabled')(), false);
	assert.equal(await callbacks.get('shortestpath.homepage.getUrl')(), undefined);
	await callbacks.get('shortestpath.homepage.open')();
	assert.equal(starts, 0);
	assert.equal(calls.some(call => call[0] === 'shortestpath.mode.home'), false);
	featureEnabled = true;
	await refreshFeatures();
	await callbacks.get('shortestpath.homepage.open')();
	assert.deepEqual({ starts, command: calls.at(-1)[0] }, { starts: 0, command: 'shortestpath.mode.home' });
	const url = await callbacks.get('shortestpath.homepage.getUrl')();
	const origin = new URL(url).origin;
	assert.equal(await callbacks.get('shortestpath.homepage.getUrl')(), url);
	const data = await (await fetch(origin + '/api/ide')).json();
	assert.deepEqual({ recent: data.recent[0].name, favorite: data.favorites[0].name, activity: data.heatmap.days[0].count }, { recent: 'actual-project', favorite: 'AtCoder', activity: 2 });
	assert.match(await (await fetch(origin + '/ide-theme.css')).text(), /#123456/);
	assert.equal((await post(origin, '/api/command', { command: 'workbench.action.files.newUntitledFile', args: [] })).status, 200);
	assert.equal(calls.at(-1)[0], 'workbench.action.files.newUntitledFile');
	assert.equal(calls.at(-1)[1].languageId, 'cpp');
	const unsupported = await post(origin, '/api/command', { command: 'arbitrary.command', args: [] });
	assert.equal(unsupported.status, 500);
	assert.match((await unsupported.json()).error, /请升级 IDE/);
	const missing = await post(origin, '/api/command', { command: 'shortestpath.mode.dashboard', args: [] });
	assert.match((await missing.json()).error, /请升级 IDE/);
	assert.equal(calls.some(call => call[0] === 'shortestpath.mode.dashboard'), false);
	assert.equal(calls.some(call => call[0] === 'arbitrary.command'), false);
	assert.equal(starts, 1);
	featureEnabled = false;
	await refreshFeatures();
	assert.equal(await callbacks.get('shortestpath.homepage.isEnabled')(), false);
	assert.equal(await callbacks.get('shortestpath.homepage.getUrl')(), undefined);
	await assert.rejects(fetch(origin));
});

test('local Home debugging is available only in source builds with an explicit environment flag', async () => {
	const vm = require('node:vm');
	for (const development of [false, true]) {
		const callbacks = new Map(), subscriptions = [];
		let options, flagRequests = 0;
		const event = () => ({ dispose() {} });
		const exports = {};
		vm.runInNewContext(await readFile(path.join(__dirname, '../out/homepage.js'), 'utf8'), {
			exports, console, process: { env: { SHORTESTPATH_HOMEPAGE_DEBUG: '1' } },
			setInterval: () => ({ unref() {} }), clearInterval() {},
			require: id => {
				if (id === './localization') { return { localize: value => value }; }
				if (id === './featureConfiguration') { return { fetchFeatureConfiguration: async () => { flagRequests++; return { homepage: false }; } }; }
				if (id === 'vscode') { return {
					commands: { registerCommand: (id, callback) => { callbacks.set(id, callback); return event(); }, executeCommand: async id => id === 'shortestpath.homepage.isDevelopment' ? development : undefined },
					window: { onDidChangeActiveColorTheme: event },
					workspace: { onDidChangeConfiguration: event, onDidChangeWorkspaceFolders: event, onDidSaveTextDocument: event },
				}; }
				if (id.endsWith('server.cjs')) { return { createHomepageServer: async value => { options = value; return { listen: async () => 'http://127.0.0.1:1234', close: async () => {} }; } }; }
				return require(id);
			},
		});
		exports.registerHomepage({ extensionPath: path.resolve(__dirname, '..'), globalStorageUri: { fsPath: '/debug-data' }, subscriptions });
		assert.equal(await callbacks.get('shortestpath.homepage.isEnabled')(), development);
		const url = await callbacks.get('shortestpath.homepage.getUrl')();
		if (development) {
			assert.match(url, /127\.0\.0\.1/);
			assert.equal(flagRequests, 0);
			assert.equal(options.localHtmlPath, path.resolve(__dirname, '../../../remote_configurations/homepage/index.html'));
			assert.equal(options.sourceUrl, '');
			assert.equal(options.fallbackSourceUrl, '');
			assert.equal(path.basename(options.dataDir), 'homepage-debug');
		} else {
			assert.equal(url, undefined);
			assert.equal(options, undefined);
			assert.equal(flagRequests, 1);
		}
		subscriptions.forEach(item => item.dispose());
	}
});

test('local debugging rereads HTML on navigation and retains real IDE data and theme injection', async t => {
	const dataDir = await mkdtemp(path.join(tmpdir(), 'homepage-debug-'));
	const localHtmlPath = path.join(dataDir, 'local.html');
	await writeFile(localHtmlPath, '<html><head></head><body>First draft</body></html>');
	let downloads = 0;
	const nativeFetch = globalThis.fetch;
	t.mock.method(globalThis, 'fetch', (url, options) => {
		if (String(url).startsWith('https:')) { downloads++; throw new Error('Unexpected remote request'); }
		return nativeFetch(url, options);
	});
	const app = await createHomepageServer({ dataDir, localHtmlPath, sourceUrl: 'https://updates.example/index.html', getData: async () => ({ favorites: [{ name: 'Real saved site' }] }), getTheme: async () => ':root{--vscode-editor-background:#123456}' });
	t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
	const origin = await app.listen(0);
	const first = await fetch(origin);
	assert.equal(new URL(first.url).pathname, '/debug/index.html');
	const html = await first.text();
	assert.match(html, /First draft/);
	assert.match(html, /Real saved site/);
	assert.match(html, /#123456/);
	await writeFile(localHtmlPath, '<html><head></head><body>Second draft</body></html>');
	assert.match(await (await fetch(origin)).text(), /Second draft/);
	assert.equal((await (await post(origin, '/api/check')).json()).configured, false);
	assert.equal(downloads, 0);
});

test('direct HTML updates delete the previous HTML after activation and retain the installed fallback', async t => {
	const dataDir = await mkdtemp(path.join(tmpdir(), 'homepage-update-'));
	const fallback = await readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
	const updated = fallback.replace('今天，也向前一步。', '继续你的训练。');
	const nativeFetch = globalThis.fetch;
	let published = false;
	t.mock.method(globalThis, 'fetch', (input, options) => {
		if (String(input) === 'https://updates.example/index.html') {return Promise.resolve(new Response(published ? updated : fallback));}
		return nativeFetch(input, options);
	});
	let app = await createHomepageServer({ dataDir, sourceUrl: 'https://updates.example/index.html' });
	t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
	let origin = await app.listen(0);
	const original = await fetch(origin);
	assert.equal(original.headers.get('Content-Security-Policy'), null);
	const oldId = new URL(original.url).pathname.split('/')[2];
	assert.match(await original.text(), /今天，也向前一步/);
	published = true;
	assert.ok((await (await post(origin, '/api/check')).json()).pending);
	assert.equal((await fetch(origin + '/releases/' + oldId + '/index.html')).status, 200);
	assert.match(await (await fetch(origin)).text(), /继续你的训练/);
	assert.equal((await fetch(origin + '/releases/' + oldId + '/index.html')).status, 404);
	await assert.rejects(access(path.join(dataDir, 'releases', oldId)));
	await access(path.join(__dirname, 'public', 'index.html'));
	await app.close();
	app = await createHomepageServer({ dataDir }); origin = await app.listen(0);
	assert.match(await (await fetch(origin)).text(), /继续你的训练/);
	await assert.rejects(access(path.join(dataDir, 'releases', oldId)));
});

test('GitHub failures fall back to GitCode, ETags stay source-specific, and checks run every 12 hours', async t => {
	const dataDir = await mkdtemp(path.join(tmpdir(), 'homepage-mirror-'));
	const nativeFetch = globalThis.fetch, nativeInterval = globalThis.setInterval;
	const sourceUrl = 'https://github.example/index.html', fallbackSourceUrl = 'https://gitcode.example/index.html';
	const html = '<html><head></head><body>Mirror homepage</body></html>';
	const requests = []; let phase = 'http', interval;
	t.mock.method(globalThis, 'setInterval', (callback, ms) => { interval = ms; return nativeInterval(callback, ms); });
	t.mock.method(globalThis, 'fetch', (input, options) => {
		const url = String(input);
		if (url !== sourceUrl && url !== fallbackSourceUrl) {return nativeFetch(input, options);}
		requests.push({ url, etag: options.headers['If-None-Match'] });
		if (url === sourceUrl) {
			if (phase === 'http') {return Promise.resolve(new Response('', { status: 503 }));}
			if (phase === 'network') {return Promise.reject(new Error('Network unavailable'));}
			if (phase === 'invalid') {return Promise.resolve(new Response('Invalid HTML'));}
			return Promise.resolve(new Response(html, { headers: { ETag: 'github-tag' } }));
		}
		return Promise.resolve(options.headers['If-None-Match'] === 'gitcode-tag' ? new Response(null, { status: 304 }) : new Response(html, { headers: { ETag: 'gitcode-tag' } }));
	});
	const app = await createHomepageServer({ dataDir, sourceUrl, fallbackSourceUrl });
	t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
	const origin = await app.listen(0);
	assert.equal(interval, 12 * 60 * 60_000);
	assert.ok((await (await post(origin, '/api/check')).json()).pending);
	assert.deepEqual(requests.map(item => item.url), [sourceUrl, fallbackSourceUrl]);
	assert.match(await (await fetch(origin)).text(), /Mirror homepage/);
	for (phase of ['network', 'invalid']) {
		requests.length = 0;
		await post(origin, '/api/check');
		assert.deepEqual(requests, [{ url: sourceUrl, etag: undefined }, { url: fallbackSourceUrl, etag: 'gitcode-tag' }]);
	}
	phase = 'success'; requests.length = 0;
	await post(origin, '/api/check');
	assert.deepEqual(requests, [{ url: sourceUrl, etag: undefined }]);
});

test('countdowns use distributed dates and preserve negative day differences', async () => {
	const vm = require('node:vm');
	const html = await readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
	const source = html.split('<script>')[1].split('</script>')[0];
	class Element {
		constructor() { this.children = []; }
		append(...items) { this.children.push(...items); }
		replaceChildren(...items) { this.children = items; }
	}
	const nodes = new Map();
	const context = vm.createContext({
		document: { createElement: () => new Element() },
		$: selector => { if (!nodes.has(selector)) {nodes.set(selector, new Element());} return nodes.get(selector); },
		text: zh => zh, english: false,
		distributed: { countdowns: [{ title: 'NOIP', date: '2026-11-28' }, { title: 'NOI', date: null }], motivation: { zh: '继续向前' } },
		reconcile: (_parent, _key, _value, render) => render(),
	});
	vm.runInContext(source.slice(source.indexOf('function personal('), source.indexOf('function favorites(')), context);
	vm.runInContext('personal({ today: "2026-11-30", countdowns: [{title: "Override", date: "2099-01-01"}] })', context);
	const items = nodes.get('#countdown').children;
	assert.equal(items[0].children[0].textContent, 'NOIP');
	assert.equal(items[0].children[1].children[0].textContent, '-2');
	assert.equal(items[0].onclick, undefined);
	assert.equal(items[1].children[2].textContent, '日期待公布');
});

test('invalid downloads preserve the current HTML', async t => {
	const dataDir = await mkdtemp(path.join(tmpdir(), 'homepage-test-'));
	const nativeFetch = globalThis.fetch;
	t.mock.method(globalThis, 'fetch', (input, options) => {
		if (String(input) === 'https://updates.example/index.html') {return Promise.resolve(new Response('not an HTML document'));}
		return nativeFetch(input, options);
	});
	const app = await createHomepageServer({ dataDir, sourceUrl: 'https://updates.example/index.html' });
	t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
	const origin = await app.listen(0);
	assert.match((await (await post(origin, '/api/check')).json()).message, /完整 HTML/);
	assert.match(await (await fetch(origin)).text(), /今天，也向前一步/);
});

test('the distributed HTML is self-contained and its scripts parse', async () => {
	const html = await readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
	const vm = require('node:vm');
	assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+stylesheet/);
	assert.match(html, /NOIP 2026/);
	assert.match(html, /NOI 2027/);
	assert.doesNotMatch(html, /模拟发布|训练数据为演示|独立演示/);
	for (const script of html.split('<script>').slice(1)) {assert.doesNotThrow(() => new vm.Script(script.split('</script>')[0]));}
});

test('favorites leave Loading for missing data and recover when data arrives', async () => {
	const vm = require('node:vm');
	const html = await readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
	const source = html.split('<script>')[1].split('</script>')[0];
	const section = source.slice(source.indexOf('function favorites('), source.indexOf('async function refresh('));
	const created = [];
	class Element {
		constructor(tagName) { this.children = []; this.dataset = {}; this.tagName = tagName; created.push(this); }
		append(...items) { this.children.push(...items); }
		replaceChildren(...items) { this.children = items; }
		setAttribute() {}
	}
	const parent = new Element();
	parent.textContent = 'Loading…';
	const context = vm.createContext({
		document: { createElement: tagName => new Element(tagName) },
		$: () => parent, text: (_zh, en) => en, command() {}, refresh() {},
		empty: (node, message) => { node.replaceChildren(); node.textContent = message; },
	});
	vm.runInContext(section, context);
	vm.runInContext('reconcile($("#favorite-items"), "snapshot", undefined, () => favorites(undefined, true))', context);
	assert.equal(parent.textContent, 'Could not load favorites.');
	assert.equal(parent.children[0].textContent, 'Retry ↗');
	vm.runInContext('reconcile($("#favorite-items"), "snapshot", [], () => favorites([]))', context);
	assert.equal(parent.textContent, 'Save websites in the browser to see them here.');
	vm.runInContext('reconcile($("#favorite-items"), "snapshot", [{name:"AtCoder",url:"https://atcoder.jp/"}], () => favorites([{name:"AtCoder",url:"https://atcoder.jp/"}]))', context);
	assert.equal(parent.children[0].children[1].textContent, 'AtCoder');
	vm.runInContext('favorites([{name:"AtCoder",url:"https://atcoder.jp/",favicon:"https://atcoder.jp/custom.png"}])', context);
	assert.equal(created.some(node => node.tagName === 'img'), false);
	vm.runInContext('favorites([{name:"AtCoder",url:"https://atcoder.jp/",favicon:"data:image/png;base64,aWNvbg=="}])', context);
	const image = created.find(node => node.tagName === 'img');
	assert.equal(image.src, 'data:image/png;base64,aWNvbg==');
	assert.equal(image.referrerPolicy, 'no-referrer');
	assert.equal(image.onerror, undefined);
	image.onload();
	assert.equal(parent.children[0].children[0].children[0], image);
});

test('foreign origins cannot invoke IDE commands', async t => {
	const dataDir = await mkdtemp(path.join(tmpdir(), 'homepage-test-'));
	let executed = false;
	const app = await createHomepageServer({ dataDir, executeCommand: async () => { executed = true; } });
	t.after(async () => { await app.close(); await rm(dataDir, { recursive: true, force: true }); });
	const origin = await app.listen(0);
	const response = await fetch(origin + '/api/command', { method: 'POST', headers: { Origin: 'https://example.com', 'X-ShortestPath-Homepage': '1' } });
	assert.deepEqual({ status: response.status, executed }, { status: 403, executed: false });
});
