/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as vm from 'node:vm';
import * as ts from 'typescript';
import { test } from 'node:test';

function createHost(format?: (source: string, tabSize: number) => Promise<string>, storedState = new Map<string, unknown>(), portableDataPath?: string) {
	const commands = new Map<string, () => void>();
	const setupSelections: object[] = [];
	const root = path.resolve(__dirname, '../..');
	const uri = (fsPath: string, scheme = 'file') => ({ fsPath, scheme, toString: () => scheme + '://' + fsPath });
	let pickFolder: () => Promise<ReturnType<typeof uri>[] | undefined> = async () => [uri(root)];
	let openError: Error | undefined;
	const openedFolders: Array<{ fsPath: string; completed: unknown; options: unknown }> = [];
	let dialogCalls = 0;
	const settings = new Map<string, unknown>();
	const globalState = storedState;
	const scheduled: Array<() => void> = [];
	const panels: ReturnType<typeof createPanel>[] = [];
	let held: { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void } | undefined;
	const fonts = { fonts: ['Menlo'] };
	let fontReads = 0;
	function createPanel() {
		let listener!: (message: unknown) => Promise<void>;
		let disposed!: () => void;
		const messages: Array<{ type: string; value?: unknown; message?: string; workspaceFolder?: string }> = [];
		const panel = {
			closed: false, title: '', reveals: 0,
			webview: { html: '', async postMessage(message: typeof messages[number]) { messages.push(message); return true; }, onDidReceiveMessage(callback: typeof listener) { listener = callback; } },
			reveal() { panel.reveals++; },
			onDidDispose(callback: () => void) { disposed = callback; },
			dispose() { if (!panel.closed) { panel.closed = true; disposed(); } },
			receive(message: unknown) { return listener(message); },
			messages
		};
		return panel;
	}
	const vscode = {
		env: { language: 'zh-cn' }, ViewColumn: { Active: 1 }, ConfigurationTarget: { Global: 1 },
		Uri: { file: uri },
		window: { async showOpenDialog(options: { canSelectFiles: boolean; canSelectFolders: boolean; canSelectMany: boolean }) {
			assert.deepEqual([options.canSelectFiles, options.canSelectFolders, options.canSelectMany], [false, true, false]);
			dialogCalls++; return pickFolder();
		}, createWebviewPanel(_type: string, title: string) { const panel = createPanel(); panel.title = title; panels.push(panel); return panel; }, async showWarningMessage() {}, onDidChangeActiveColorTheme() { return { dispose() {} }; } },
		extensions: { all: [], getExtension() { return { packageJSON: { version: '0.1.0' } }; } },
		commands: { registerCommand(id: string, handler: () => void) { commands.set(id, handler); return { dispose() {} }; }, async executeCommand(command: string, folder?: ReturnType<typeof uri> | { mode: 'recommended' | 'repair'; cppStandard: string; installToolchain: boolean; completeSetup: boolean }, options?: unknown) {
			if (command === 'vscode.openFolder') {
				assert.ok(folder && 'fsPath' in folder);
				openedFolders.push({ fsPath: folder.fsPath, completed: settings.get('shortestpath.setup.completed'), options: JSON.parse(JSON.stringify(options)) });
				if (openError) { throw openError; }
			}
			if (command === 'shortestpath.applyFirstRunSetup') {
				assert.ok(folder && 'mode' in folder);
				const selection = folder;
				setupSelections.push(JSON.parse(JSON.stringify(selection)));
				if (selection.mode === 'recommended') {
					for (const [key, value] of Object.entries(JSON.parse(fs.readFileSync(path.join(root, 'resources/recommended-settings.json'), 'utf8')))) { settings.set(key, value); }
				}
				return true;
			}
			return { success: true, message: 'ready' }; } },
		workspace: {
			workspaceFolders: undefined as Array<{ uri: ReturnType<typeof uri> }> | undefined,
			getConfiguration(section?: string) {
				return { get(key: string) { return settings.get(section ? section + '.' + key : key); }, async update(key: string, value: unknown) {
					const fullKey = section ? section + '.' + key : key;
					if (fullKey === 'editor.fontSize' && held) { await held.promise; }
					settings.set(fullKey, value);
				} };
			},
			onDidChangeConfiguration() { return { dispose() {} }; }
		}
	};
	const source = fs.readFileSync(path.join(root, 'src/gettingStarted.ts'), 'utf8') + '\nexport const testApi = { openGettingStarted, maybeAutoOpenGettingStarted, registerGettingStarted };';
	const exports: { testApi?: { openGettingStarted: (context: unknown) => void; maybeAutoOpenGettingStarted: (context: unknown) => Promise<void>; registerGettingStarted: (context: unknown) => void } } = {};
	vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
		exports, process: { platform: process.platform, env: { ...process.env, VSCODE_PORTABLE: portableDataPath } }, console, setTimeout: (callback: () => void) => scheduled.push(callback),
		require(id: string): unknown {
			if (id === 'vscode') { return vscode; }
			if (id === './bundledFont') { return { withBundledCodeFont: (html: string) => html }; }
			if (id === './environmentSetup') { return require('../environmentSetup'); }
			if (id === './firstRunEditorSession') { return require('../firstRunEditorSession'); }
			if (id === './firstRunPreview') { return require('../firstRunPreview'); }
			if (id === './editorPreview') { return { EditorPreview: class { async render(_tabSize: number, _hints: boolean, _format: boolean, source: string) { return { source: format ? await format(source, _tabSize) : source }; } dispose() {} } }; }
			if (id === './firstRunView') { return { firstRunView: (...args: unknown[]) => JSON.stringify(args) }; }
			if (id === './rememberedCodeFolder') { return require('../rememberedCodeFolder'); }
			if (id === './systemFonts') { return { async getSystemFonts() { fontReads++; return fonts; } }; }
			if (id === './localization') { return { localize: (text: string) => text, localizeToolchainProgress: (text: string) => text, localizeWebviewHtml: (html: string) => html, localizeFormat: (text: string, ...args: string[]) => text.replace(/\{(\d+)\}/g, (_match, index) => args[Number(index)]) }; }
			if (id === './simpleSettings') { return { getThemeOptions: () => [], findCppStandard: (flags: string) => flags.includes('c++23') ? 'c++23' : 'c++20', isCppStandard: () => true }; }
			return require(id);
		}
	});
	const context = { subscriptions: [], extensionPath: root, globalState: { async update(key: string, value: unknown) { globalState.set(key, value); }, get(key: string) { return globalState.get(key); } } };
	const open = () => exports.testApi!.openGettingStarted(context);
	const holdSave = () => {
		let resolve!: () => void, reject!: (error: Error) => void;
		held = { promise: new Promise<void>((yes, no) => { resolve = yes; reject = no; }), resolve: () => resolve(), reject: error => reject(error) };
		void held.promise.catch(() => {});
		return held;
	};
	return { register: () => exports.testApi!.registerGettingStarted(context), runCommand: (id: string) => { const command = commands.get(id); assert.ok(command); command(); }, root, uri, globalState, setupSelections, openedFolders, dialogCalls: () => dialogCalls, setPicker: (picker: typeof pickFolder) => { pickFolder = picker; }, setWorkspace: (folder: string) => { vscode.workspace.workspaceFolders = [{ uri: uri(folder) }]; }, failOpen: (error: Error | undefined) => { openError = error; }, panels, open, settings, holdSave, autoOpen: () => exports.testApi!.maybeAutoOpenGettingStarted(context), scheduled, fontReads: () => fontReads, reopen: () => { const callback = scheduled.shift(); assert.ok(callback); callback(); } };
}

const editor = { fontFamily: 'Menlo', fontSize: 18, tabSize: 2, cppTemplate: 'int main() {}', fontLigatures: false, colorTheme: 'One Monokai', autoDetectColorScheme: false, autoSave: 'onFocusChange', autoFormat: true, clangdVariableTypeHints: true };

test('completed setup preserves the restored mode instead of opening the guide', async () => {
	const host = createHost();
	host.settings.set('shortestpath.setup.completed', true);
	await host.autoOpen();
	assert.deepEqual({ panels: host.panels.length, scheduled: host.scheduled.length }, { panels: 0, scheduled: 0 });
});

test('the existing command opens initial setup after completion, preserves preferences, and reveals a single panel', async () => {
	const host = createHost();
	host.settings.set('shortestpath.setup.completed', true);
	host.settings.set('editor.fontSize', 22);
	host.register();
	host.runCommand('shortestpath.openGettingStarted');
	host.runCommand('shortestpath.openGettingStarted');
	const panel = host.panels[0];
	const view = JSON.parse(panel.webview.html);
	await panel.receive({ type: 'environmentState' });
	assert.deepEqual({
		panels: host.panels.length, title: panel.title, reveals: panel.reveals,
		page: view[3], fontSize: view[2].fontSize,
		completed: host.settings.get('shortestpath.setup.completed'),
		version: host.globalState.get('shortestpath.gettingStarted.version'),
		state: panel.messages.at(-1)?.type
	}, { panels: 1, title: '初始配置', reveals: 1, page: 'compile', fontSize: 22, completed: true, version: undefined, state: 'environmentState' });
	panel.dispose();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(host.scheduled.length, 0);
});

test('manual environment checks preserve preferences and the selected C++ version', async () => {
	const host = createHost();
	host.settings.set('shortestpath.setup.completed', true);
	const preferences = {
		'editor.fontSize': 22, 'workbench.colorTheme': 'Custom Theme',
		'judger.language.cpp.Template': 'int main() { return 7; }', 'judger.language.cpp.Args': '-std=c++23 -O3'
	};
	for (const [key, value] of Object.entries(preferences)) { host.settings.set(key, value); }
	host.open();
	const panel = host.panels[0];
	await panel.receive({ type: 'startEnvironment' });
	await panel.receive({ type: 'nextEditor' });
	assert.deepEqual({
		selection: host.setupSelections,
		preferences: Object.fromEntries(Object.keys(preferences).map(key => [key, host.settings.get(key)])),
		page: panel.messages.at(-1)?.value
	}, { selection: [{ mode: 'repair', installToolchain: false, cppStandard: 'c++23', completeSetup: false }], preferences, page: 'editor' });
});

test('first-run environment checks apply the recommended defaults', async () => {
	const host = createHost();
	host.open();
	await host.panels[0].receive({ type: 'startEnvironment' });
	assert.deepEqual(host.setupSelections, [{ mode: 'recommended', installToolchain: false, cppStandard: 'c++20', completeSetup: false }]);
	assert.equal(host.settings.get('editor.fontSize'), 14);
});

test('a delayed first-run open rechecks completion', async () => {
	const host = createHost();
	await host.autoOpen();
	host.settings.set('shortestpath.setup.completed', true);
	host.reopen();
	assert.equal(host.panels.length, 0);
});

test('manual initial setup completes and starts with a fresh checklist next time', async () => {
	const host = createHost();
	host.settings.set('shortestpath.setup.completed', true);
	const panel = await readyEditor(host);
	await panel.receive({ type: 'complete', value: editor });
	host.open();
	const view = JSON.parse(host.panels[1].webview.html);
	assert.deepEqual({ closed: panel.closed, page: view[3], ready: view[0].ready }, { closed: true, page: 'compile', ready: false });
});

async function readyEditor(host: ReturnType<typeof createHost>, currentFolder = true) {
	if (currentFolder) { host.setWorkspace(host.root); }
	host.open();
	const panel = host.panels[0];
	await panel.receive({ type: 'startEnvironment' });
	await panel.receive({ type: 'nextEditor' });
	await panel.receive({ type: 'nextTemplate' });
	await panel.receive({ type: 'nextWorkspace' });
	await panel.receive({ type: 'chooseWorkspace' });
	return panel;
}

test('reopened webview handshake restores the checklist without font selection', async () => {
	const host = createHost(); host.open();
	const first = host.panels[0];
	await first.receive({ type: 'environmentState' });
	assert.equal(first.messages.at(-1)?.type, 'environmentState');
	first.dispose(); host.reopen();
	await host.panels[1].receive({ type: 'environmentState' });
	assert.equal(host.panels[1].messages.at(-1)?.type, 'environmentState');
	assert.equal(host.fontReads(), 0);
});

test('completion closes the current reopened panel after waiting for settings', async () => {
	const host = createHost(), first = await readyEditor(host), save = host.holdSave();
	const completing = first.receive({ type: 'complete', value: editor });
	first.dispose(); host.reopen();
	const reopened = host.panels[1];
	assert.equal(JSON.parse(reopened.webview.html)[4], true);
	save.resolve(); await completing;
	assert.equal(host.settings.get('shortestpath.setup.completed'), true);
	assert.equal(host.settings.get('editor.fontSize'), 18);
	assert.equal(reopened.closed, true);
});

test('completion failure unlocks the current reopened panel and keeps setup incomplete', async () => {
	const host = createHost(), first = await readyEditor(host), save = host.holdSave();
	const completing = first.receive({ type: 'complete', value: editor });
	first.dispose(); host.reopen();
	const reopened = host.panels[1];
	save.reject(new Error('settings unavailable')); await completing;
	assert.equal(reopened.messages.at(-1)?.type, 'completeError');
	assert.match(reopened.messages.at(-1)?.message ?? '', /settings unavailable/);
	assert.notEqual(host.settings.get('shortestpath.setup.completed'), true);
	assert.equal(reopened.closed, false);
});

test('a scheduled reopen does not restore onboarding after completion succeeds', async () => {
	const host = createHost(), first = await readyEditor(host), save = host.holdSave();
	const completing = first.receive({ type: 'complete', value: editor });
	first.dispose();
	save.resolve(); await completing;
	host.reopen();
	assert.equal(host.settings.get('shortestpath.setup.completed'), true);
	assert.equal(host.panels.length, 1);
});

test('immediate completion waits for template formatting and persists the formatted snapshot', async () => {
	let resolve!: (value: string) => void;
	const formatting = new Promise<string>(yes => { resolve = yes; });
	const calls: Array<{ source: string; tabSize: number }> = [];
	const host = createHost(async (source, tabSize) => { calls.push({ source, tabSize }); return formatting; });
	const panel = await readyEditor(host);
	const completing = panel.receive({ type: 'complete', value: { ...editor, tabSize: 8, cppTemplate: 'int main(){return 3;}' } });
	for (let i = 0; i < 30 && !calls.length; i++) { await new Promise<void>(resolve => setImmediate(resolve)); }
	assert.deepEqual(calls, [{ source: 'int main(){return 3;}', tabSize: 8 }]);
	assert.notEqual(host.settings.get('shortestpath.setup.completed'), true);
	resolve('int main() {\n        return 3;\n}\n');
	await completing;
	assert.equal(host.settings.get('judger.language.cpp.Template'), 'int main() {\n        return 3;\n}\n');
	assert.equal(host.settings.get('shortestpath.setup.completed'), true);
});

test('a formatting failure keeps completion blocked and exposes the error', async () => {
	const host = createHost(async () => { throw new Error('formatter unavailable'); });
	const panel = await readyEditor(host);
	await panel.receive({ type: 'complete', value: editor });
	assert.notEqual(host.settings.get('shortestpath.setup.completed'), true);
	assert.equal(panel.closed, false);
	assert.match(panel.messages.at(-1)?.message ?? '', /formatter unavailable/);
});

test('directory selection survives cancellation, navigation, and reopening', async () => {
	const host = createHost(), panel = await readyEditor(host, false);
	assert.equal(panel.messages.at(-1)?.workspaceFolder, host.root);
	host.setPicker(async () => undefined);
	await panel.receive({ type: 'chooseWorkspace' });
	assert.equal(panel.messages.at(-1)?.workspaceFolder, host.root);
	await panel.receive({ type: 'nextTemplate' });
	await panel.receive({ type: 'nextWorkspace' });
	assert.equal(panel.messages.at(-1)?.workspaceFolder, host.root);
	panel.dispose(); host.reopen();
	assert.deepEqual(JSON.parse(host.panels[1].webview.html).slice(3), ['workspace', false, host.root, false]);
	await host.panels[1].receive({ type: 'complete', value: editor });
	assert.deepEqual(host.openedFolders, [{ fsPath: host.root, completed: undefined, options: { forceReuseWindow: true } }]);
});

test('missing or invalid directory blocks completion and exposes selection errors', async () => {
	const host = createHost();
	host.setPicker(async () => undefined);
	const panel = await readyEditor(host, false);
	await panel.receive({ type: 'complete', value: { ...editor, workspaceFolder: host.root } });
	assert.equal(host.openedFolders.length, 0);
	assert.notEqual(host.settings.get('shortestpath.setup.completed'), true);
	host.setPicker(async () => [host.uri(path.join(host.root, 'package.json'))]);
	await panel.receive({ type: 'chooseWorkspace' });
	assert.match(panel.messages.at(-1)?.message ?? '', /有效的本地目录/);
	host.setPicker(async () => [host.uri(host.root, 'remote')]);
	await panel.receive({ type: 'chooseWorkspace' });
	assert.equal(panel.messages.at(-1)?.workspaceFolder, undefined);
	assert.match(panel.messages.at(-1)?.message ?? '', /有效的本地目录/);
});

test('folder picker serializes clicks and blocks completion until selection returns', async () => {
	const host = createHost(), panel = await readyEditor(host, false);
	let release!: (result: ReturnType<typeof host.uri>[] | undefined) => void;
	host.setPicker(() => new Promise(resolve => { release = resolve; }));
	const picking = panel.receive({ type: 'chooseWorkspace' });
	await panel.receive({ type: 'chooseWorkspace' });
	await panel.receive({ type: 'complete', value: editor });
	await panel.receive({ type: 'nextTemplate' });
	assert.equal(host.dialogCalls(), 2);
	assert.equal(host.openedFolders.length, 0);
	release(undefined); await picking;
	await panel.receive({ type: 'complete', value: editor });
	assert.equal(host.openedFolders.length, 1);
});

test('opening failure preserves directory selection and allows retry', async () => {
	const host = createHost(), panel = await readyEditor(host, false);
	host.failOpen(new Error('folder unavailable'));
	await panel.receive({ type: 'complete', value: editor });
	assert.notEqual(host.settings.get('shortestpath.setup.completed'), true);
	assert.equal(panel.closed, false);
	assert.match(panel.messages.at(-1)?.message ?? '', /folder unavailable/);
	await panel.receive({ type: 'chooseWorkspace' });
	assert.equal(panel.messages.at(-1)?.workspaceFolder, host.root);
	host.failOpen(undefined);
	host.setWorkspace(host.root);
	await panel.receive({ type: 'complete', value: editor });
	assert.equal(panel.closed, true);
	assert.equal(host.settings.get('shortestpath.setup.completed'), true);
});

test('completing in the selected current directory avoids reopening the window', async () => {
	const host = createHost();
	host.setWorkspace(host.root);
	const panel = await readyEditor(host);
	await panel.receive({ type: 'complete', value: editor });
	assert.equal(host.openedFolders.length, 0);
	assert.equal(host.settings.get('shortestpath.setup.completed'), true);
	assert.equal(panel.closed, true);
});

test('reopening during folder selection restores the pending dialog and receives its result', async () => {
	for (const cancelled of [false, true]) {
		const host = createHost();
		let release!: (result: ReturnType<typeof host.uri>[] | undefined) => void;
		host.setPicker(() => new Promise(resolve => { release = resolve; }));
		host.open();
		const first = host.panels[0];
		await first.receive({ type: 'startEnvironment' });
		await first.receive({ type: 'nextEditor' });
		await first.receive({ type: 'nextTemplate' });
		await first.receive({ type: 'nextWorkspace' });
		const picking = first.receive({ type: 'chooseWorkspace' });
		first.dispose(); host.reopen();
		const reopened = host.panels[1];
		assert.equal(JSON.parse(reopened.webview.html)[6], true);
		await reopened.receive({ type: 'chooseWorkspace' });
		await reopened.receive({ type: 'complete', value: editor });
		assert.equal(host.dialogCalls(), 1);
		assert.equal(host.openedFolders.length, 0);
		release(cancelled ? undefined : [host.uri(host.root)]); await picking;
		assert.equal(reopened.messages.at(-1)?.type, 'workspaceResult');
		assert.equal(reopened.messages.at(-1)?.workspaceFolder, cancelled ? undefined : host.root);
		if (cancelled) {
			host.setPicker(async () => [host.uri(host.root)]);
			await reopened.receive({ type: 'chooseWorkspace' });
		}
		await reopened.receive({ type: 'complete', value: editor });
		assert.equal(reopened.closed, false);
		assert.equal(reopened.messages.at(-1)?.type, 'folderOpenRequested');
		assert.equal(host.openedFolders.length, 1);
	}
});

test('a fulfilled folder-open request keeps the guide retryable until the target workspace activates', async () => {
	const host = createHost(), panel = await readyEditor(host, false);
	await panel.receive({ type: 'complete', value: editor });
	assert.equal(panel.closed, false);
	assert.equal(panel.messages.at(-1)?.type, 'folderOpenRequested');
	assert.notEqual(host.settings.get('shortestpath.setup.completed'), true);
	assert.equal(host.globalState.get('shortestpath.gettingStarted.codeFolder'), host.root);
	await panel.receive({ type: 'complete', value: editor }); // User cancelled switching and retries.
	assert.equal(host.openedFolders.length, 2);
	host.setWorkspace(host.root); // The target workspace activates after a successful switch.
	await host.autoOpen();
	assert.equal(host.settings.get('shortestpath.setup.completed'), true);
	assert.equal(host.globalState.get('shortestpath.gettingStarted.codeFolder'), undefined);
	assert.equal(host.scheduled.length, 0);
});

test('choosing a different directory clears the previous pending open request', async () => {
	const host = createHost(), panel = await readyEditor(host, false);
	await panel.receive({ type: 'complete', value: editor });
	assert.equal(host.globalState.get('shortestpath.gettingStarted.codeFolder'), host.root);
	const otherFolder = path.dirname(host.root);
	host.setPicker(async () => [host.uri(otherFolder)]);
	await panel.receive({ type: 'chooseWorkspace' });
	assert.equal(panel.messages.at(-1)?.workspaceFolder, otherFolder);
	assert.equal(host.globalState.get('shortestpath.gettingStarted.codeFolder'), undefined);
});

test('the guide defaults to Fira Code, loads system fonts on demand, and persists font choices', async () => {
	const host = createHost(); host.open();
	const panel = host.panels[0];
	assert.equal(JSON.parse(panel.webview.html)[2].fontFamily, 'Fira Code');
	assert.equal(host.fontReads(), 0);
	await panel.receive({ type: 'systemFonts' });
	assert.deepEqual(JSON.parse(JSON.stringify(panel.messages.at(-1))), { type: 'systemFonts', value: { fonts: ['Menlo'] } });
	await panel.receive({ type: 'startEnvironment' });
	await panel.receive({ type: 'nextEditor' });
	await panel.receive({ type: 'save', page: 'font', value: { ...editor, fontFamily: '"Fira Code"', fontLigatures: true }, requestId: 1 });
	await panel.receive({ type: 'nextTemplate' });
	assert.deepEqual([host.settings.get('editor.fontFamily'), host.settings.get('editor.fontLigatures'), host.settings.get('editor.fontSize')], ['"Fira Code"', true, 18]);
});

test('a chosen directory survives restarting before completion and reopening setup after completion', async () => {
	const host = createHost();
	await readyEditor(host, false);
	const remembered = host.globalState.get('shortestpath.gettingStarted.rememberedCodeFolder');
	assert.equal(JSON.parse(JSON.stringify(remembered)).path, host.root);
	const restarted = createHost(undefined, host.globalState);
	const panel = await readyEditor(restarted, false);
	assert.equal(JSON.parse(panel.webview.html)[5], host.root);
	restarted.setWorkspace(host.root);
	await panel.receive({ type: 'complete', value: editor });
	assert.equal(restarted.globalState.get('shortestpath.gettingStarted.codeFolder'), undefined);
	restarted.open(); // The settings entry uses the same command after setup is complete.
	assert.equal(JSON.parse(restarted.panels[1].webview.html)[5], host.root);
	const reinstalled = createHost(undefined, restarted.globalState);
	reinstalled.settings.set('shortestpath.setup.completed', true);
	reinstalled.open();
	assert.equal(JSON.parse(reinstalled.panels[0].webview.html)[5], host.root);
});

test('invalid remembered directories stay remembered and a single current local folder is used when available', () => {
	const storage = new Map<string, unknown>([['shortestpath.gettingStarted.rememberedCodeFolder', { path: path.join(os.tmpdir(), 'shortestpath-missing-folder', 'code') }]]);
	const empty = createHost(undefined, storage); empty.open();
	assert.equal(JSON.parse(empty.panels[0].webview.html)[5], null);
	const current = createHost(undefined, storage); current.setWorkspace(current.root); current.open();
	assert.equal(JSON.parse(current.panels[0].webview.html)[5], current.root);
	assert.equal(storage.size, 1);
	const file = createHost(undefined, new Map([['shortestpath.gettingStarted.rememberedCodeFolder', { path: path.join(current.root, 'package.json') }]]));
	file.open();
	assert.equal(JSON.parse(file.panels[0].webview.html)[5], null);
});

test('portable directory memory and an unfinished folder switch follow a moved portable data folder', async t => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shortestpath-directory-memory-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const oldRoot = path.join(root, 'old'), newRoot = path.join(root, 'new');
	const data = path.join(oldRoot, 'data'), code = path.join(oldRoot, 'code');
	fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(code);
	const first = createHost(undefined, new Map(), data);
	first.setPicker(async () => [first.uri(code)]);
	const panel = await readyEditor(first, false);
	await panel.receive({ type: 'complete', value: editor });
	assert.equal(first.globalState.get('shortestpath.gettingStarted.codeFolder'), code);
	fs.renameSync(oldRoot, newRoot);
	const movedCode = path.join(newRoot, 'code');
	const moved = createHost(undefined, first.globalState, path.join(newRoot, 'data'));
	moved.setWorkspace(movedCode);
	await moved.autoOpen();
	assert.deepEqual([moved.settings.get('shortestpath.setup.completed'), moved.globalState.get('shortestpath.gettingStarted.codeFolder')], [true, undefined]);
	moved.open();
	assert.equal(JSON.parse(moved.panels[0].webview.html)[5], movedCode);
});

test('remembered directories take priority over the currently open folder and cancelled picks retain the memory', async () => {
	const host = createHost(undefined, new Map([['shortestpath.gettingStarted.rememberedCodeFolder', { path: path.resolve(__dirname, '../../../..') }]]));
	host.setWorkspace(host.root); host.setPicker(async () => undefined);
	const panel = await readyEditor(host);
	assert.equal(panel.messages.at(-1)?.workspaceFolder, path.resolve(__dirname, '../../../..'));
	assert.equal((host.globalState.get('shortestpath.gettingStarted.rememberedCodeFolder') as { path: string }).path, path.resolve(__dirname, '../../../..'));
});

test('choosing the current fallback folder clears an unavailable pending folder switch', async () => {
	const missing = path.join(os.tmpdir(), 'shortestpath-missing-folder', 'old');
	const host = createHost(undefined, new Map<string, unknown>([
		['shortestpath.gettingStarted.codeFolder', missing],
		['shortestpath.gettingStarted.rememberedCodeFolder', { path: missing }]
	]));
	await readyEditor(host);
	assert.deepEqual([
		host.globalState.get('shortestpath.gettingStarted.codeFolder'),
		(host.globalState.get('shortestpath.gettingStarted.rememberedCodeFolder') as { path: string }).path
	], [undefined, host.root]);
});
