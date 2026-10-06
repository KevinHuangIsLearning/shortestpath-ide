/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';
import type { SnippetEntry } from '../snippetsView';

async function createHost(write: (source: string) => Promise<void> = async () => { }) {
	const commands = new Map<string, () => Promise<void>>();
	const messages: Array<Record<string, any>> = [];
	const tokenRequests: string[] = [];
	let receive!: (message: Record<string, unknown>) => Promise<void>;
	let onTheme!: () => void;
	let onConfiguration!: (event: { affectsConfiguration: (key: string) => boolean }) => void;
	let onDispose!: () => void;
	let disposedListeners = 0;
	const listener = () => ({ dispose() { disposedListeners++; } });
	const panel = {
		webview: { html: '', async postMessage(message: Record<string, unknown>) { messages.push(JSON.parse(JSON.stringify(message))); return true; }, onDidReceiveMessage(handler: typeof receive) { receive = handler; return listener(); } },
		onDidDispose(handler: () => void) { onDispose = handler; }, reveal() { }
	};
	const vscode = {
		ViewColumn: { Active: 1 },
		Uri: { parse(value: string) { return { fsPath: value }; }, joinPath(uri: { fsPath: string }, ...parts: string[]) { return { fsPath: path.join(uri.fsPath, ...parts) }; } },
		window: { createWebviewPanel() { return panel; }, onDidChangeActiveColorTheme(handler: () => void) { onTheme = handler; return listener(); }, async showWarningMessage(_message: string, _options: unknown, action: string) { return action; } },
		workspace: {
			getConfiguration() { return { get: () => 4 }; },
			onDidChangeConfiguration(handler: typeof onConfiguration) { onConfiguration = handler; return listener(); },
			fs: { async stat(uri: { fsPath: string }) { assert.equal(uri.fsPath, '/profile/independent-snippets/cpp.json'); return {}; }, async readFile() { return Buffer.from('{"A":{"prefix":"a","body":["int main() {}"],"include":["**/*.cpp"],"exclude":["**/test.cpp"]}}'); }, async writeFile(_uri: unknown, bytes: Buffer) { await write(bytes.toString()); } }
		},
		commands: { registerCommand(id: string, run: () => Promise<void>) { commands.set(id, run); return { dispose() { } }; }, async executeCommand(command: string, source: string) {
			if (command === '_shortestpath.snippetsHome') { return '/profile/independent-snippets'; }
			assert.equal(command, '_shortestpath.cppPreviewTokens'); tokenRequests.push(source); return [[{ text: source, style: 'color:#abc' }]];
		} }
	};
	const exports: { registerSimpleSettings?: (context: unknown) => void } = {};
	vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../simpleSettings.js'), 'utf8'), {
		exports, Buffer, console,
		require(id: string): unknown {
			if (id === 'vscode') { return vscode; }
			if (id === './localization') { return { localize: (value: string) => value, localizeWebviewHtml: (value: string) => value, localizeFormat: (value: string, ...args: string[]) => value.replace(/\{(\d+)\}/g, (_match, index) => args[Number(index)]) }; }
			if (id === './systemFonts') { return {}; }
			if (id === './snippetsView') { return require('../snippetsView'); }
			if (id === './bundledSnippets') { return require('../bundledSnippets'); }
			if (id === './firstRunPreview') { return require('../firstRunPreview'); }
			return require(id);
		}
	});
	exports.registerSimpleSettings!({ subscriptions: [], globalStorageUri: { fsPath: '/profile/globalStorage/shortestpath' } });
	await commands.get('shortestpath.configureCppSnippets')!();
	return { panel, messages, tokenRequests, receive, onTheme, onConfiguration, onDispose, disposedListeners: () => disposedListeners };
}

const entry = (body: string): SnippetEntry => ({ name: 'A', prefix: 'a', body, description: '', include: '**/*.cpp', exclude: '**/test.cpp' });
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('serializes overlapping autosaves and preserves hidden include/exclude restrictions', async () => {
	let release!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	const writes: string[] = [];
	const host = await createHost(async source => { writes.push(source); if (writes.length === 1) { await held; } });
	await host.receive({ type: 'save', language: 'cpp', entries: [entry('first')], revision: 1 });
	await host.receive({ type: 'save', language: 'cpp', entries: [entry('second')], revision: 2 });
	await settle();
	assert.equal(writes.length, 1);
	release(); await settle();
	assert.equal(writes.length, 2);
	assert.deepEqual(JSON.parse(writes[1]).A, { prefix: 'a', body: ['second'], include: ['**/*.cpp'], exclude: ['**/test.cpp'] });
	assert.deepEqual(host.messages.filter(message => message.type === 'saved').map(message => message.revision), [1, 2]);
});

test('reports save errors and continues processing later edits', async () => {
	let attempts = 0;
	const host = await createHost(async () => { if (++attempts === 1) { throw new Error('disk full'); } });
	await host.receive({ type: 'save', language: 'cpp', entries: [entry('first')], revision: 1 }); await settle();
	await host.receive({ type: 'save', language: 'cpp', entries: [entry('second')], revision: 2 }); await settle();
	const saves = host.messages.filter(message => message.type === 'saved');
	assert.match(saves[0].error, /disk full/);
	assert.equal(saves[1].error, undefined);
	assert.equal(saves[1].revision, 2);
});

test('uses IDE tokenization, refreshes theme/font changes, and disposes page listeners', async () => {
	const host = await createHost();
	await host.receive({ type: 'highlight', source: 'int value;', requestId: 7 });
	assert.deepEqual(host.tokenRequests, ['int value;']);
	assert.deepEqual(host.messages.at(-1), { type: 'highlight', source: 'int value;', requestId: 7, lines: [[{ text: 'int value;', style: 'color:#abc' }]] });
	host.onTheme(); host.onConfiguration({ affectsConfiguration: key => key === 'editor' });
	assert.equal(host.messages.filter(message => message.type === 'refreshHighlight').length, 2);
	assert.equal(host.messages.at(-1)!.tabSize, 4);
	await host.receive({ type: 'confirmDelete', language: 'cpp', name: 'A', requestId: 11 });
	assert.deepEqual(host.messages.at(-1), { type: 'deleteConfirmed', language: 'cpp', requestId: 11 });
	host.onDispose();
	assert.equal(host.disposedListeners(), 3);
});
