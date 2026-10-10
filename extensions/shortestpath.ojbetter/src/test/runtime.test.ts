/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext, Script } from 'node:vm';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { browserBootstrap } from '../browserRuntime';
import { Assets } from '../assets';
import { platformForUrl } from '../sites';
import { Preferences } from '../storage';

test('site matching rejects lookalikes, unrelated subdomains and non-web schemes', () => {
	const urls = ['https://atcoder.jp/contests/a', 'https://codeforces.com/problemset', 'https://m1.codeforces.com/', 'https://codeforc.es/', 'https://www.codeforc.es/', 'https://atcoder.jp.evil.test/', 'https://sub.atcoder.jp/', 'https://codeforces.com.evil.test/', 'file://codeforces.com/a', 'about:blank'];
	assert.deepEqual(urls.map(platformForUrl), ['atcoder', 'codeforces', 'codeforces', 'codeforces', 'codeforces', undefined, undefined, undefined, undefined, undefined]);
});

test('bundled payload hashes, adapter boundaries and complete script syntax are valid', () => {
	const assets = new Assets(join(__dirname, '../../resources'));
	const source = assets.source('bridge', { atcoder: true, codeforces: true });
	assert.doesNotThrow(() => new Script(source));
	const files = readdirSync(join(__dirname, '../../resources'), { recursive: true, withFileTypes: true }).filter(entry => entry.isFile() && entry.name !== 'manifest.json').map(entry => join(entry.parentPath, entry.name).slice(join(__dirname, '../../resources').length + 1));
	assert.deepEqual(Object.keys(assets.manifest.files).sort(), files.sort());
	const math = source.match(/const MathJax = ([\s\S]*?);\n\s*const workerSources/)![1];
	let delimiters: { left: string; right: string; display: boolean }[] = [];
	const shim = runInNewContext('(' + math + ')', { renderMathInElement: (_element: unknown, options: { delimiters: typeof delimiters }) => { delimiters = options.delimiters; } });
	shim.Hub.Queue(['Typeset', null, {}]);
	assert.deepEqual(Array.from(delimiters, item => item.left), ['$$$$$$', '$$$', '$$', '$', '\\(', '\\[']);
	assert.equal(assets.manifest.scripts.atcoder.version, '1.25.1');
	assert.equal(assets.manifest.scripts.codeforces.version, '1.87.1');
	assert.equal(assets.localResource('https://aowuucdn.oss-accelerate.aliyuncs.com/resources/locales/atcoder-better/common.json?cache=1')?.includes('settings'), true);
});

test('preferences serialize writes, survive a new instance and separate platforms', async () => {
	const saved: Record<string, unknown> = {};
	let active = 0;
	const memento = {
		keys: () => Object.keys(saved),
		get: <T>(key: string, fallback?: T) => saved[key] as T ?? fallback,
		update: async (key: string, value: unknown) => {
			assert.equal(++active, 1);
			await new Promise(resolve => setTimeout(resolve, 2));
			saved[key] = value;
			active--;
		}
	};
	const storage = new Preferences(memento);
	await Promise.all([storage.write('atcoder', 'theme', 'light', false), storage.write('atcoder', 'language', 'en', false), storage.write('codeforces', 'theme', 'dark', false)]);
	await storage.write('atcoder', 'theme', undefined, true);
	const restored = new Preferences(memento);
	assert.deepEqual([restored.get('atcoder'), restored.get('codeforces')], [{ language: 'en' }, { theme: 'dark' }]);
});

interface Message { id: number; operation: string; args: Record<string, unknown> }

async function runtime() {
	const messages: Message[] = [];
	const world: Record<string, unknown> = { console, setTimeout, clearTimeout, atob, ReadableStream, TextDecoder, Uint8Array, Blob };
	world.bridge = (raw: string) => {
		const message = JSON.parse(raw) as Message;
		messages.push(message);
		if (message.operation === 'hydrate') {
			queueMicrotask(() => receive({ id: message.id, value: { theme: 'dark' } }));
		}
	};
	const receive = (reply: object) => (world.__shortestpathOJBetterReceive as (reply: object) => void)(reply);
	const api = await runInNewContext(`(${browserBootstrap.toString()})('bridge')`, world) as Awaited<ReturnType<typeof browserBootstrap>>;
	return { api, receive, messages };
}

test('synchronous values preserve newer local changes while host snapshots are arriving', async () => {
	const { api, receive, messages } = await runtime();
	api.GM_setValue('theme', 'light');
	receive({ id: 0, event: 'values', value: { theme: 'dark', language: 'en' } });
	assert.deepEqual([api.GM_getValue('theme'), api.GM_getValue('language')], ['light', 'en']);
	receive({ id: messages.at(-1)!.id });
	await Promise.resolve();
	receive({ id: 0, event: 'values', value: { theme: 'light', language: 'ja' } });
	assert.deepEqual([api.GM_getValue('theme'), api.GM_getValue('language')], ['light', 'ja']);
});

test('streaming XHR delivers bytes before load and supports explicit abort and timeout', async () => {
	const { api, receive, messages } = await runtime();
	let stream: ReadableStream<Uint8Array> | undefined;
	let loaded = false;
	const request = api.GM_xmlhttpRequest({ url: 'https://api.example.test/', responseType: 'stream', onloadstart: value => { stream = (value as { response: ReadableStream<Uint8Array> }).response; }, onload: () => { loaded = true; } });
	const id = messages.at(-1)!.id;
	receive({ id, event: 'start', status: 200 });
	receive({ id, event: 'chunk', data: Buffer.from('data: hello\n').toString('base64') });
	const reader = stream!.getReader();
	assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: hello\n');
	assert.equal(loaded, false);
	request.abort();
	assert.equal(messages.at(-1)!.operation, 'abort');
	receive({ id, event: 'load' });
	assert.equal((await reader.read()).done, true);
	assert.equal(loaded, true);
	let timedOut = false;
	api.GM_xmlhttpRequest({ url: 'https://api.example.test/', ontimeout: () => { timedOut = true; } });
	receive({ id: messages.at(-1)!.id, event: 'timeout', error: 'Request timed out' });
	assert.equal(timedOut, true);
});

test('upstream automatic refresh waits until all preference writes are acknowledged', async () => {
	const { api, receive, messages } = await runtime();
	api.GM_setValue('theme', 'light');
	api.GM_setValue('showLoading', true);
	let flushed = false;
	const flush = api.flushValues().then(() => { flushed = true; });
	const writes = messages.filter(message => message.operation === 'set');
	receive({ id: writes[0].id });
	await Promise.resolve();
	assert.equal(flushed, false);
	receive({ id: writes[1].id });
	await flush;
	assert.equal(flushed, true);
});
