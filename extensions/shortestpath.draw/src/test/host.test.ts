/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';
import { ClientMessage, DraftSnapshot, HostMessage } from '../protocol';

const draft = (text: string): DraftSnapshot => ({ scene: JSON.stringify({ type: 'excalidraw', elements: [{ id: 'text', type: 'text', text }], appState: {}, files: {} }), library: '{"type":"excalidrawlib","libraryItems":[]}' });
class MockPanel {
	title = '';
	messages: HostMessage[] = [];
	html = '';
	disposed = 0;
	receive: (message: ClientMessage) => Promise<void> = async () => { };
	onDispose: () => void = () => { };
	readonly webview = {
		options: {}, cspSource: 'https://*.vscode-resource.test',
		get html() { return ''; }, set html(_value: string) { },
		asWebviewUri: (uri: { fsPath: string }) => ({ toString: () => `https://local.vscode-resource.test${uri.fsPath}` }),
		postMessage: async (message: HostMessage) => { this.messages.push(JSON.parse(JSON.stringify(message))); return true; },
		onDidReceiveMessage: (run: typeof this.receive) => { this.receive = run; return this.listener(); },
	};
	constructor(readonly viewType: string) {
		Object.defineProperty(this.webview, 'html', { get: () => this.html, set: (value: string) => { this.html = value; } });
	}
	listener() { return { dispose: () => { this.disposed++; } }; }
	onDidDispose(run: () => void) { this.onDispose = run; return this.listener(); }
	reveal() { }
	dispose() { this.onDispose(); }
}

async function createHost(folder: string) {
	const panels: MockPanel[] = [];
	const commands = new Map<string, () => void>();
	const modeChanges: string[] = [];
	const errors: string[] = [];
	const confirmations: boolean[] = [];
	const saveUris: string[] = [];
	let importUri: string | undefined;
	let exportDelay: Promise<void> | undefined;
	const vscode = {
		env: { language: 'zh-cn' }, ViewColumn: { Active: 1, Beside: 2 }, ColorThemeKind: { Light: 1, HighContrastLight: 4 },
		Uri: { joinPath(uri: { fsPath: string }, ...parts: string[]) { return { fsPath: path.join(uri.fsPath, ...parts) }; } },
		window: {
			activeColorTheme: { kind: 2 },
			createWebviewPanel(viewType: string) { const panel = new MockPanel(viewType); panels.push(panel); return panel; },
			onDidChangeActiveColorTheme() { return { dispose() { } }; },
			registerWebviewPanelSerializer() { return { dispose() { } }; },
			async showErrorMessage(message: string) { errors.push(message); },
			async showWarningMessage(_message: string, _options: { modal: boolean }, action: string) { return confirmations.shift() ? action : undefined; },
			async showOpenDialog() { return importUri ? [{ fsPath: importUri }] : undefined; },
			async showSaveDialog(options: { defaultUri: { fsPath: string } }) { saveUris.push(options.defaultUri.fsPath); await exportDelay; return { fsPath: path.join(folder, 'export.excalidraw') }; },
		},
		workspace: { fs: { readFile: (uri: { fsPath: string }) => fs.readFile(uri.fsPath), writeFile: (uri: { fsPath: string }, bytes: Buffer) => fs.writeFile(uri.fsPath, bytes) } },
		commands: {
			registerCommand(id: string, run: () => void) { commands.set(id, run); return { dispose() { } }; },
			async executeCommand(id: string) { modeChanges.push(id); if (id === 'shortestpath.mode.draw') { commands.get('shortestpath.draw.open')!(); } },
		},
	};
	const exports: { activate?: (context: object) => void; deactivate?: () => Promise<void> } = {};
	vm.runInNewContext(await fs.readFile(path.resolve(__dirname, '../extension.js'), 'utf8'), {
		exports, Buffer, console,
		require(id: string): unknown { return id === 'vscode' ? vscode : require(id.startsWith('./') ? path.resolve(__dirname, '..', id) : id); },
	});
	exports.activate!({ subscriptions: [], storageUri: { fsPath: folder }, globalStorageUri: { fsPath: '/unused-global' }, extensionUri: { fsPath: '/extension' } });
	commands.get('shortestpath.draw.open')!();
	const page = panels[0];
	return { page, panels, modeChanges, errors, confirmations, saveUris, setImportUri: (uri: string) => { importUri = uri; }, delayExport: (delay: Promise<void>) => { exportDelay = delay; }, flush: exports.deactivate! };
}

test('restores the draft and synchronizes companion edits without stealing the code editor mode', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-draw-host-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const host = await createHost(folder);
	await host.page.receive({ type: 'ready' });
	await host.page.receive({ type: 'save', snapshot: draft('first'), revision: 1 });
	await host.page.receive({ type: 'openBeside', snapshot: draft('final before transfer') });
	const companion = host.panels[1];
	await companion.receive({ type: 'ready' });
	await companion.receive({ type: 'save', snapshot: draft('code side edit'), revision: 2 });
	assert.deepEqual({ modes: host.modeChanges, type: companion.viewType, restored: companion.messages[0], synchronized: host.page.messages.at(-1) }, {
		modes: ['shortestpath.mode.solve'], type: 'shortestpath.draw.companion', restored: { type: 'init', snapshot: draft('final before transfer') }, synchronized: { type: 'replace', snapshot: draft('code side edit') },
	});
	await companion.receive({ type: 'openMode', snapshot: draft('back to mode') });
	await host.flush();
	const restored = await createHost(folder);
	await restored.page.receive({ type: 'ready' });
	assert.deepEqual(restored.page.messages[0], { type: 'init', snapshot: draft('back to mode') });
	host.page.dispose(); companion.dispose(); restored.page.dispose();
	assert.equal(host.page.disposed, 2);
});

test('does not overwrite damaged storage, rejects saves before initialization and retries a repaired draft', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-draw-host-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	await fs.mkdir(path.join(folder, 'sketchpad'));
	await fs.writeFile(path.join(folder, 'sketchpad', 'draft.json'), 'broken');
	const host = await createHost(folder);
	await host.page.receive({ type: 'ready' });
	await host.page.receive({ type: 'save', snapshot: draft('must not replace'), revision: 1 });
	assert.equal(await fs.readFile(path.join(folder, 'sketchpad', 'draft.json'), 'utf8'), 'broken');
	assert.match((host.page.messages[0] as { error: string }).error, /无法恢复/);
	await fs.writeFile(path.join(folder, 'sketchpad', 'draft.json'), JSON.stringify(draft('repaired')));
	await host.page.receive({ type: 'ready' });
	assert.deepEqual(host.page.messages.at(-1), { type: 'init', snapshot: draft('repaired') });
	host.page.dispose();
});

test('persists an already received final save when the panel closes behind a pending native dialog', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-draw-host-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const host = await createHost(folder);
	await host.page.receive({ type: 'ready' });
	let release!: () => void;
	host.delayExport(new Promise<void>(resolve => { release = resolve; }));
	const exporting = host.page.receive({ type: 'export', data: draft('export').scene, format: 'excalidraw' });
	const saving = host.page.receive({ type: 'save', snapshot: draft('last edit'), revision: 1 });
	await new Promise<void>(resolve => setImmediate(resolve));
	host.page.dispose();
	release();
	await Promise.all([exporting, saving]);
	await host.flush();
	assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder, 'sketchpad', 'draft.json'), 'utf8')), draft('last edit'));
});

test('canceling clear/import preserves the scene; confirmed replacement and native export keep user content', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-draw-host-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const host = await createHost(folder);
	await host.page.receive({ type: 'ready' });
	await host.page.receive({ type: 'clear', snapshot: draft('kept') });
	assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder, 'sketchpad', 'draft.json'), 'utf8')), draft('kept'));
	const file = path.join(folder, 'import.excalidraw');
	await fs.writeFile(file, draft('题意原文 <script> code').scene);
	host.setImportUri(file);
	await host.page.receive({ type: 'import', snapshot: draft('kept') });
	assert.deepEqual(JSON.parse(await fs.readFile(path.join(folder, 'sketchpad', 'draft.json'), 'utf8')), draft('kept'));
	host.confirmations.push(true);
	await host.page.receive({ type: 'import', snapshot: draft('kept') });
	assert.deepEqual(host.page.messages.at(-1), { type: 'replace', snapshot: draft('题意原文 <script> code') });
	await host.page.receive({ type: 'export', data: draft('题意原文 <script> code').scene, format: 'excalidraw' });
	assert.equal(await fs.readFile(path.join(folder, 'export.excalidraw'), 'utf8'), draft('题意原文 <script> code').scene);
	host.confirmations.push(true);
	await host.page.receive({ type: 'clear', snapshot: draft('题意原文 <script> code') });
	const cleared = host.page.messages.at(-1) as { snapshot: DraftSnapshot };
	assert.deepEqual(JSON.parse(cleared.snapshot.scene).elements, []);
	assert.deepEqual(host.errors, []);
	host.page.dispose();
});
