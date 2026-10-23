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
import type { TemplateEditorBounds } from '../templateEditor';

type NativeLayout = { bounds: TemplateEditorBounds; selectionRevision: number; source?: string };
type NativeSnapshot = { selectionRevision: number; contentRevision: number; source: string };

async function createHost(write: (source: string) => Promise<void> = async () => { }, layout: (request: NativeLayout) => Promise<NativeSnapshot | undefined> = async () => undefined) {
	const snippetsHome = path.resolve('/profile/independent-snippets');
	const commands = new Map<string, () => Promise<void>>();
	const messages: Array<Record<string, any>> = [];
	const layoutRequests: NativeLayout[] = [];
	let receive!: (message: Record<string, unknown>) => Promise<void>;
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
		window: { createWebviewPanel() { return panel; }, async showWarningMessage(_message: string, _options: unknown, action: string) { return action; } },
		workspace: {
			getConfiguration() { return { get: () => 4 }; },
			fs: { async stat(uri: { fsPath: string }) { assert.equal(uri.fsPath, path.join(snippetsHome, 'cpp.json')); return {}; }, async readFile() { return Buffer.from('{"A":{"prefix":"a","body":["int main() {}"],"include":["**/*.cpp"],"exclude":["**/test.cpp"]}}'); }, async writeFile(_uri: unknown, bytes: Buffer) { await write(bytes.toString()); } }
		},
		commands: { registerCommand(id: string, run: () => Promise<void>) { commands.set(id, run); return { dispose() { } }; }, async executeCommand(command: string, bounds: TemplateEditorBounds, selectionRevision: number, source?: string) {
			if (command === '_shortestpath.snippetsHome') { return snippetsHome; }
			assert.equal(command, '_shortestpath.layoutSnippetEditor');
			const request = { bounds, selectionRevision, source };
			layoutRequests.push(request);
			return layout(request);
		} }
	};
	const exports: { registerSimpleSettings?: (context: unknown) => void } = {};
	vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../simpleSettings.js'), 'utf8'), {
		exports, Buffer, console,
		require(id: string): unknown {
			if (id === 'vscode') { return vscode; }
			if (id === './bundledFont') { return { withBundledCodeFont: (html: string) => html }; }
			if (id === './localization') { return { localize: (value: string) => value, localizeWebviewHtml: (value: string) => value, localizeFormat: (value: string, ...args: string[]) => value.replace(/\{(\d+)\}/g, (_match, index) => args[Number(index)]) }; }
			if (id === './systemFonts') { return {}; }
			if (id === './snippetsView') { return require('../snippetsView'); }
			if (id === './bundledSnippets') { return require('../bundledSnippets'); }
			if (id === './fontSelection') { return require('../fontSelection'); }
			if (id === './firstRunPreview') { return require('../firstRunPreview'); }
			if (id === './compilerRuntime') { return require('../compilerRuntime'); }
			if (id === './platformSettings') { return require('../platformSettings'); }
			if (id === './templateEditor') { return require('../templateEditor'); }
			return require(id);
		}
	});
	exports.registerSimpleSettings!({ subscriptions: [], globalStorageUri: { fsPath: '/profile/globalStorage/shortestpath' } });
	await commands.get('shortestpath.configureCppSnippets')!();
	return { panel, messages, layoutRequests, receive, onDispose, disposedListeners: () => disposedListeners };
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

test('serializes native editor layouts, forwards final body snapshots, and disposes page listeners', async () => {
	let release!: () => void;
	const held = new Promise<void>(resolve => { release = resolve; });
	const snapshot = { selectionRevision: 0, contentRevision: 3, source: 'final native edit' };
	const host = await createHost(undefined, async request => {
		if (request.selectionRevision === 0) { await held; return undefined; }
		return snapshot;
	});
	const bounds = { left: 10, top: 20, width: 640, height: 360, clipTop: 0, clipBottom: 800 };
	await host.receive({ type: 'snippetEditorLayout', bounds, selectionRevision: 0, source: 'int value;' });
	await host.receive({ type: 'snippetEditorLayout', bounds, selectionRevision: 1, source: 'int next;' });
	await settle();
	assert.deepEqual(host.layoutRequests, [{ bounds, selectionRevision: 0, source: 'int value;' }]);
	release(); await settle();
	assert.deepEqual(host.layoutRequests, [{ bounds, selectionRevision: 0, source: 'int value;' }, { bounds, selectionRevision: 1, source: 'int next;' }]);
	assert.deepEqual(host.messages.at(-1), { type: 'snippetBodySnapshot', ...snapshot });
	await host.receive({ type: 'confirmDelete', language: 'cpp', name: 'A', requestId: 11 });
	assert.deepEqual(host.messages.at(-1), { type: 'deleteConfirmed', language: 'cpp', requestId: 11 });
	host.onDispose();
	assert.equal(host.disposedListeners(), 1);
});
