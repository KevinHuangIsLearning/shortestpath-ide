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
import { DrawingFiles } from '../drawingFiles';
import { ClientMessage, DraftSnapshot, DrawingEntry, HostMessage } from '../protocol';

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
	onDidChangeViewState() { return this.listener(); }
	dispose() { this.onDispose(); }
}

async function activeDrawing(folder: string): Promise<DraftSnapshot> {
	const catalog = JSON.parse(await fs.readFile(path.join(folder, 'sketchpad', 'files.json'), 'utf8'));
	return catalog.entries.find((entry: { id: string }) => entry.id === catalog.active).snapshot;
}

async function createHost(folder: string) {
	const panels: MockPanel[] = [];
	const commands = new Map<string, (value?: unknown) => unknown>();
	const modeChanges: string[] = [];
	const errors: string[] = [];
	const confirmations: boolean[] = [];
	const saveUris: string[] = [];
	const names: (string | undefined)[] = [];
	const destinations: string[] = [];
	let importUri: string | undefined;
	let exportDelay: Promise<void> | undefined;
	let treeProvider!: { getChildren(): Promise<DrawingEntry[]>; handleDrag(source: DrawingEntry[], transfer: Map<string, { value: object }>): void; handleDrop(target: DrawingEntry | undefined, transfer: Map<string, { value: object }>): Promise<void> };
	const editRequests: unknown[][] = [];
	const revealed: DrawingEntry[] = [];
	const tree = { selection: [] as DrawingEntry[], async reveal(entry: DrawingEntry) { revealed.push(entry); }, dispose() { } };
	const vscode = {
		DataTransferItem: class { constructor(readonly value: object) { } },
		EventEmitter: class { readonly event = () => ({ dispose() { } }); fire() { } dispose() { } },
		env: { language: 'zh-cn' }, ViewColumn: { Active: 1, Beside: 2 }, ColorThemeKind: { Light: 1, HighContrastLight: 4 },
		Uri: { joinPath(uri: { fsPath: string }, ...parts: string[]) { return { fsPath: path.join(uri.fsPath, ...parts) }; } },
		window: {
			createTreeView(_id: string, options: { treeDataProvider: typeof treeProvider }) { treeProvider = options.treeDataProvider; return tree; },
			activeColorTheme: { kind: 2 },
			createWebviewPanel(viewType: string) { const panel = new MockPanel(viewType); panels.push(panel); return panel; },
			onDidChangeActiveColorTheme() { return { dispose() { } }; },
			registerWebviewPanelSerializer() { return { dispose() { } }; },
			async showErrorMessage(message: string) { errors.push(message); },
			async showWarningMessage(_message: string, _options: { modal: boolean }, action: string) { return confirmations.shift() ? action : undefined; },
			async showInputBox() { throw new Error('Use the native tree row input'); },
			async showQuickPick(items: { id: string; label: string }[]) { const id = destinations.shift(); return items.find(item => item.id === id); },
			async showOpenDialog() { return importUri ? [{ fsPath: importUri }] : undefined; },
			async showSaveDialog(options: { defaultUri: { fsPath: string } }) { saveUris.push(options.defaultUri.fsPath); await exportDelay; return { fsPath: path.join(folder, 'export.excalidraw') }; },
		},
		workspace: { fs: { readFile: (uri: { fsPath: string }) => fs.readFile(uri.fsPath), writeFile: (uri: { fsPath: string }, bytes: Buffer) => fs.writeFile(uri.fsPath, bytes) } },
		commands: {
			registerCommand(id: string, run: (value?: unknown) => unknown) { commands.set(id, run); return { dispose() { } }; },
			async executeCommand(id: string, ...args: unknown[]) {
				if (id.startsWith('_workbench.treeView.editItem.')) { editRequests.push(args); return names.shift(); }
				modeChanges.push(id); if (id === 'shortestpath.mode.draw') { commands.get('shortestpath.draw.open')!(); }
				return undefined;
			},
		},
	};
	const treeExports: { DrawingTree?: new (read: () => Promise<object>) => { refresh(): void; dispose(): void } } = {};
	vm.runInNewContext(await fs.readFile(path.resolve(__dirname, '../drawingTree.js'), 'utf8'), { exports: treeExports, module: { set exports(value: object) { Object.defineProperties(treeExports, Object.getOwnPropertyDescriptors(value)); } }, require: (id: string) => id === 'vscode' ? vscode : require(id) });
	const exports: { activate?: (context: object) => void; deactivate?: () => Promise<void> } = {};
	vm.runInNewContext(await fs.readFile(path.resolve(__dirname, '../extension.js'), 'utf8'), {
		exports, module: { set exports(value: object) { Object.assign(exports, value); } }, Buffer, console,
		require(id: string): unknown { return id === 'vscode' ? vscode : id === './drawingTree' ? treeExports : require(id.startsWith('./') ? path.resolve(__dirname, '..', id) : id); },
	});
	exports.activate!({ subscriptions: [], storageUri: { fsPath: folder }, globalStorageUri: { fsPath: '/unused-global' }, extensionUri: { fsPath: '/extension' } });
	await commands.get('shortestpath.draw.open')!();
	const page = panels[0];
	return { page, panels, commands, tree, children: () => treeProvider.getChildren(), drag: (source: DrawingEntry[], transfer: Map<string, { value: object }>) => treeProvider.handleDrag(source, transfer), drop: (target: DrawingEntry | undefined, transfer: Map<string, { value: object }>) => treeProvider.handleDrop(target, transfer), modeChanges, editRequests, revealed, errors, confirmations, saveUris, names, destinations, setImportUri: (uri: string) => { importUri = uri; }, delayExport: (delay: Promise<void>) => { exportDelay = delay; }, flush: exports.deactivate! };
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
		modes: ['shortestpath.mode.solve'], type: 'shortestpath.draw.companion', restored: { type: 'init', snapshot: draft('final before transfer'), fileId: 'draft' }, synchronized: { type: 'replace', snapshot: draft('code side edit'), fileId: 'draft' },
	});
	await companion.receive({ type: 'openMode', snapshot: draft('back to mode'), fileId: 'draft' });
	await host.flush();
	const restored = await createHost(folder);
	await restored.page.receive({ type: 'ready' });
	assert.deepEqual(restored.page.messages[0], { type: 'init', snapshot: draft('back to mode'), fileId: 'draft' });
	host.page.dispose(); companion.dispose(); restored.page.dispose();
	assert.equal(host.page.disposed, 3);
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
	assert.deepEqual(host.page.messages.at(-1), { type: 'init', snapshot: draft('repaired'), fileId: 'draft' });
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
	assert.deepEqual(await activeDrawing(folder), draft('last edit'));
});

test('canceling clear/import preserves the scene; confirmed replacement and native export keep user content', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-draw-host-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const host = await createHost(folder);
	await host.page.receive({ type: 'ready' });
	await host.page.receive({ type: 'clear', snapshot: draft('kept') });
	assert.deepEqual(await activeDrawing(folder), draft('kept'));
	const file = path.join(folder, 'import.excalidraw');
	await fs.writeFile(file, draft('题意原文 <script> code').scene);
	host.setImportUri(file);
	await host.page.receive({ type: 'import', snapshot: draft('kept') });
	assert.deepEqual(await activeDrawing(folder), draft('kept'));
	host.confirmations.push(true);
	await host.page.receive({ type: 'import', snapshot: draft('kept') });
	assert.deepEqual(host.page.messages.at(-1), { type: 'replace', snapshot: draft('题意原文 <script> code'), fileId: 'draft' });
	await host.page.receive({ type: 'export', data: draft('题意原文 <script> code').scene, format: 'excalidraw' });
	assert.equal(await fs.readFile(path.join(folder, 'export.excalidraw'), 'utf8'), draft('题意原文 <script> code').scene);
	host.confirmations.push(true);
	await host.page.receive({ type: 'clear', snapshot: draft('题意原文 <script> code'), fileId: 'draft' });
	const cleared = host.page.messages.at(-1) as { snapshot: DraftSnapshot };
	assert.deepEqual(JSON.parse(cleared.snapshot.scene).elements, []);
	assert.deepEqual(host.errors, []);
	host.page.dispose();
});

test('drawing tabs save independently, reuse files and close deleted documents', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-draw-host-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const host = await createHost(folder);
	await host.page.receive({ type: 'ready' });
	await host.page.receive({ type: 'save', snapshot: draft('original'), revision: 1, fileId: 'draft' });
	host.names.push('Folder');
	await host.page.receive({ type: 'fileAction', action: 'newFolder', id: '', snapshot: draft('original'), fileId: 'draft' });
	const state = host.page.messages.at(-1)!;
	assert.ok(state.type === 'files');
	const directory = state.state.entries.find(entry => entry.kind === 'folder')!.id;
	host.names.push('Second');
	await host.page.receive({ type: 'fileAction', action: 'newFile', id: directory, snapshot: draft('final first edit'), fileId: 'draft' });
	const secondPanel = host.panels[1];
	await secondPanel.receive({ type: 'ready' });
	const init = secondPanel.messages[0];
	assert.ok(init.type === 'init');
	const second = init.fileId!;
	assert.equal(secondPanel.title, 'Second');
	assert.equal(host.page.title, '未命名');
	await secondPanel.receive({ type: 'save', snapshot: draft('second drawing'), revision: 2, fileId: second });
	await host.page.receive({ type: 'save', snapshot: draft('background first edit'), revision: 3, fileId: 'draft' });
	assert.deepEqual(await activeDrawing(folder), draft('second drawing'));
	await secondPanel.receive({ type: 'save', snapshot: draft('wrong target'), revision: 4, fileId: 'draft' });
	assert.deepEqual(await activeDrawing(folder), draft('second drawing'));
	await secondPanel.receive({ type: 'fileAction', action: 'openFile', id: 'draft', snapshot: draft('last second edit'), fileId: second });
	assert.equal(host.panels.length, 2);
	assert.deepEqual(await activeDrawing(folder), draft('background first edit'));
	await host.page.receive({ type: 'fileAction', action: 'openFile', id: second, snapshot: draft('background first edit'), fileId: 'draft' });
	const restored = await createHost(folder);
	await restored.page.receive({ type: 'ready' });
	assert.deepEqual(restored.page.messages[0], { type: 'init', snapshot: draft('last second edit'), fileId: second });
	await restored.commands.get('shortestpath.draw.restoreTabs')!(['draft', second, 'deleted']);
	assert.equal(restored.panels.length, 2);
	await restored.panels[1].receive({ type: 'ready' });
	assert.deepEqual(restored.panels[1].messages[0], { type: 'init', snapshot: draft('background first edit'), fileId: 'draft' });
	host.names.push('Renamed');
	await host.page.receive({ type: 'fileAction', action: 'rename', id: second, snapshot: draft('background first edit'), fileId: 'draft' });
	assert.equal(secondPanel.title, 'Renamed');
	host.confirmations.push(true);
	await secondPanel.receive({ type: 'fileAction', action: 'delete', id: directory, snapshot: draft('last second edit'), fileId: second });
	await secondPanel.receive({ type: 'save', snapshot: draft('late deleted save'), revision: 5, fileId: second });
	assert.deepEqual(await activeDrawing(folder), draft('background first edit'));
	assert.deepEqual(host.errors, []);
	host.page.dispose(); restored.page.dispose();
});

test('native tree and canvas share one initialization and native actions request the live snapshot', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-draw-host-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const load = t.mock.method(DrawingFiles.prototype, 'load');
	const host = await createHost(folder);
	const listing = host.children();
	await host.page.receive({ type: 'ready' });
	const entries = await listing;
	assert.equal(load.mock.callCount(), 1);
	host.tree.selection = [entries[0]];
	await host.commands.get('shortestpath.draw.newFolder')!();
	assert.equal(host.page.messages.at(-1)?.type, 'init');
	await host.page.receive({ type: 'canvasReady', fileId: 'draft' });
	assert.deepEqual(host.page.messages.at(-1), { type: 'fileAction', action: 'newFolder', id: '' });
	host.names.push('Native folder');
	await host.page.receive({ type: 'fileAction', action: 'newFolder', id: '', snapshot: draft('latest live edit'), fileId: 'draft' });
	assert.deepEqual({ drawing: await activeDrawing(folder), names: (await host.children()).map(entry => entry.name) }, { drawing: draft('latest live edit'), names: ['Native folder', '未命名'] });
	host.page.dispose();
});


test('native drawing actions target the selected file and wait for its canvas instead of acting on another tab', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-draw-actions-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const host = await createHost(folder);
	await host.page.receive({ type: 'ready' });
	await host.page.receive({ type: 'canvasReady', fileId: 'draft' });
	const files = new DrawingFiles(path.join(folder, 'sketchpad'), 'Untitled');
	await files.load();
	await files.create('', 'Second', 'file');
	const secondId = files.state().active;
	const second = files.state().entries.find(entry => entry.id === secondId)!;
	// Reload the catalog through a separate host, as a real restart does.
	const restored = await createHost(folder);
	await restored.page.receive({ type: 'ready' });
	await restored.page.receive({ type: 'canvasReady', fileId: secondId });
	const first = (await restored.children()).find(entry => entry.id === 'draft')!;
	await restored.commands.get('shortestpath.draw.clear')!(first);
	const target = restored.panels[1];
	assert.equal(target.messages.length, 0);
	await target.receive({ type: 'ready' });
	assert.equal(target.messages.length, 1);
	await target.receive({ type: 'canvasReady', fileId: secondId });
	assert.equal(target.messages.length, 1);
	await target.receive({ type: 'canvasReady', fileId: 'draft' });
	assert.deepEqual(target.messages.at(-1), { type: 'documentAction', action: 'clear' });
	assert.equal(restored.page.messages.some(message => message.type === 'documentAction'), false);
	const count = target.messages.length;
	await restored.commands.get('shortestpath.draw.import')!(first);
	assert.equal(target.messages.length, count + 1);
	assert.deepEqual(target.messages.at(-1), { type: 'documentAction', action: 'import' });
	restored.destinations.push('svg');
	await restored.commands.get('shortestpath.draw.export')!(second);
	assert.deepEqual(restored.page.messages.at(-1), { type: 'documentAction', action: 'export', format: 'svg' });
	await restored.commands.get('shortestpath.draw.export')!(first);
	assert.equal(target.messages.length, count + 1); // Canceling the format picker does nothing.
	await restored.commands.get('shortestpath.draw.clear')!({ ...first, kind: 'folder' });
	assert.equal(target.messages.length, count + 1);
	for (const panel of [...host.panels, ...restored.panels]) { panel.dispose(); }
});


test('native tree drag moves drawings and folders, ignores external drops and prevents descendant cycles', async t => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'shortestpath-draw-drag-'));
	t.after(() => fs.rm(folder, { recursive: true, force: true }));
	const storage = new DrawingFiles(path.join(folder, 'sketchpad'), 'Untitled');
	await storage.load();
	await storage.create('', 'Folder', 'folder');
	const target = storage.state().entries.find(entry => entry.name === 'Folder')!;
	await storage.create(target.id, 'Nested', 'folder');
	const nested = storage.state().entries.find(entry => entry.name === 'Nested')!;
	const drawing = storage.state().entries.find(entry => entry.kind === 'file')!;
	const host = await createHost(folder);
	await host.children();
	const transfer = new Map<string, { value: object }>();
	host.drag([drawing], transfer);
	await host.drop(target, transfer);
	host.drag([target], transfer);
	await host.drop(nested, transfer);
	await host.drop(undefined, new Map());
	const foreignHost = await createHost(path.join(folder, 'other-workspace'));
	await foreignHost.children();
	const foreignTransfer = new Map<string, { value: object }>();
	foreignHost.drag([{ id: drawing.id, parent: '', name: 'Untitled', kind: 'file' }], foreignTransfer);
	await host.drop(nested, foreignTransfer);
	const restored = new DrawingFiles(path.join(folder, 'sketchpad'), 'Untitled');
	await restored.load();
	assert.deepEqual(restored.state().entries.map(({ name, parent }) => ({ name, parent })), [
		{ name: 'Untitled', parent: target.id }, { name: 'Folder', parent: '' }, { name: 'Nested', parent: target.id },
	]);
	host.drag([drawing], transfer);
	await host.drop(undefined, transfer);
	assert.equal(JSON.parse(await fs.readFile(path.join(folder, 'sketchpad/files.json'), 'utf8')).entries.find((entry: DrawingEntry) => entry.id === drawing.id).parent, '');
});
