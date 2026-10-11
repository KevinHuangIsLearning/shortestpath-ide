/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { platformForUrl } from '../sites';

test('activation defers payloads until an enabled supported page and shares them across tabs', async () => {
	let loads = 0;
	let connections = 0;
	let enabled = false;
	const listeners = new Map<string, (tab: { id: string; url: string }) => void>();
	const listener = (name: string) => (callback: (tab: { id: string; url: string }) => void) => { listeners.set(name, callback); return { dispose() { } }; };
	const tabs = [{ id: 'unsupported', url: 'https://example.com/' }];
	const exports = {} as { activate(context: { extensionPath: string; subscriptions: unknown[]; globalState: object }): void };
	runInNewContext(readFileSync(join(__dirname, '../extension.js'), 'utf8'), {
		exports, fetch: () => { },
		require(id: string) {
			switch (id) {
				case 'vscode': return {
					window: { browserTabs: tabs, createOutputChannel: () => ({ appendLine() { }, dispose() { } }),
						onDidOpenBrowserTab: listener('open'), onDidChangeBrowserTabState: listener('change'), onDidCloseBrowserTab: listener('close') },
					workspace: { getConfiguration: () => ({ get: () => enabled }), onDidChangeConfiguration: listener('configuration') }, env: { clipboard: {} }
				};
				case 'path': return { join };
				case './assets': return { Assets: class { manifest = { scripts: { atcoder: { name: 'test', version: '1' } } }; constructor() { loads++; } } };
				case './integration': return { connect: async () => { connections++; return { isDisposed: false, dispose() { } }; } };
				case './sites': return { platformForUrl };
				case './storage': return { Preferences: class { } };
				default: throw new Error(`Unexpected dependency ${id}`);
			}
		}
	});
	exports.activate({ extensionPath: '/isolated', subscriptions: [], globalState: {} });
	assert.strictEqual(loads, 0);
	const first = { id: 'first', url: 'https://atcoder.jp/contests/abc100/tasks/abc100_a' };
	tabs.push(first);
	listeners.get('open')!(first);
	assert.strictEqual(loads, 0);
	enabled = true;
	listeners.get('change')!(first);
	await new Promise(resolve => setImmediate(resolve));
	const second = { ...first, id: 'second' };
	tabs.push(second);
	listeners.get('open')!(second);
	await new Promise(resolve => setImmediate(resolve));
	assert.deepStrictEqual({ loads, connections }, { loads: 1, connections: 2 });
});
