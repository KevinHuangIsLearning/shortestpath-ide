/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
jest.mock('vscode', () => ({
	commands: { registerCommand: jest.fn() },
	window: { showQuickPick: jest.fn(), showInformationMessage: jest.fn(), showErrorMessage: jest.fn(), withProgress: jest.fn((_options, task) => task()) },
	workspace: { workspaceFolders: [] },
	ProgressLocation: { Notification: 15 },
}), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
jest.mock('../browserImportButton', () => ({ registerBrowserImportButtons: jest.fn() }));
import vm from 'vm';
import { parseBrowserProblems, registerBrowserImport, startShortestPathBrowserProblem, BrowserImportResult } from '../browserImport';
import * as vscode from 'vscode';
import fs from 'fs';
import { shortestPathStartProblemScript } from '../shortestpathBrowserImport';

function browser(value: unknown, scriptError = false, closeDuringParse = false, evaluate?: (expression: string) => Promise<unknown>) {
	const listeners = new Set<(message: object) => void>();
	const closeListeners = new Set<() => void>();
	const sent: { method: string; params: Record<string, unknown> }[] = [];
	const session = {
		onDidReceiveMessage: (listener: (message: object) => void) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
		onDidClose: (listener: () => void) => { closeListeners.add(listener); return { dispose: () => closeListeners.delete(listener) }; },
		sendMessage: async (raw: unknown) => {
			const message = raw as { id: number; method: string; params: Record<string, unknown>; sessionId?: string };
			sent.push(message);
			if (closeDuringParse && message.method === 'Runtime.evaluate') { for (const close of [...closeListeners]) { close(); } return; }
			let evaluated: { result?: { value: unknown }; exceptionDetails?: { text: string } } | undefined;
			if (evaluate && message.method === 'Runtime.evaluate') {
				try { evaluated = { result: { value: await evaluate(String(message.params.expression)) } }; }
				catch (error) { evaluated = { exceptionDetails: { text: String(error) } }; }
			}
			const result = message.method === 'Target.getTargets' ? { targetInfos: [{ type: 'page', targetId: 'page' }] }
				: message.method === 'Target.attachToTarget' ? { sessionId: 'attached' }
					: message.method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } }
						: message.method === 'Page.createIsolatedWorld' ? { executionContextId: 42 }
							: evaluated ? evaluated : scriptError ? { exceptionDetails: { text: 'parser failed' } } : { result: { value } };
			for (const listener of [...listeners]) { listener({ id: message.id, sessionId: message.sessionId, result }); }
		},
		close: jest.fn(async () => { }),
	};
	const tab = { id: 'browser', url: 'https://example.com/A', startCDPSession: async () => session } as vscode.BrowserTab;
	return { tab, session, sent, listeners, closeListeners };
}

test('parses multiple tasks in the main-frame isolated context and detaches', async () => {
	const tasks = [{ name: 'A', url: 'https://example.com/A', tests: [] }, { name: 'B', url: 'https://example.com/B', tests: [] }];
	const testBrowser = browser(tasks);
	expect(await parseBrowserProblems(testBrowser.tab, 'parse()')).toEqual(tasks);
	expect(testBrowser.sent[testBrowser.sent.length - 1].params).toEqual({ expression: 'parse()', contextId: 42, awaitPromise: true, returnByValue: true });
	expect([testBrowser.session.close.mock.calls.length, testBrowser.listeners.size, testBrowser.closeListeners.size]).toEqual([1, 0, 0]);
});

test('native start uses the website control and releases its CDP session', async () => {
	const testBrowser = browser(true);
	await startShortestPathBrowserProblem(testBrowser.tab);
	expect([testBrowser.sent[testBrowser.sent.length - 1].params.expression, testBrowser.session.close.mock.calls.length]).toEqual([shortestPathStartProblemScript(), 1]);
});

test.each(['unavailable', 'script', 'closed'])('native start rejects %s and releases its CDP session', async mode => {
	const testBrowser = browser(false, mode === 'script', mode === 'closed');
	await expect(startShortestPathBrowserProblem(testBrowser.tab)).rejects.toThrow();
	expect([testBrowser.session.close.mock.calls.length, testBrowser.listeners.size, testBrowser.closeListeners.size]).toEqual([1, 0, 0]);
});

async function runImportCommand(testBrowser: ReturnType<typeof browser>, importProblem: jest.Mock, folderOpen: boolean) {
	jest.replaceProperty(vscode.window, 'activeBrowserTab', testBrowser.tab);
	jest.replaceProperty(vscode.workspace, 'workspaceFolders', folderOpen ? [{ uri: { fsPath: '/workspace' } as vscode.Uri, name: 'workspace', index: 0 }] : []);
	registerBrowserImport({ subscriptions: [], extensionPath: '/extension' } as unknown as vscode.ExtensionContext, importProblem);
	const command = jest.mocked(vscode.commands.registerCommand).mock.calls.slice(-1)[0][1];
	return await command(undefined, 'ExampleParser');
}

beforeEach(() => {
	// The virtual vscode module exposes mutable window state for command dispatch tests.
	Object.defineProperty(vscode.window, 'activeBrowserTab', { value: undefined, writable: true, configurable: true });
	jest.clearAllMocks();
});

afterEach(() => jest.restoreAllMocks());

test.each([true, false])('ShortestPath import bypasses Companion even without a workspace (folderOpen=%s)', async folderOpen => {
	const testBrowser = browser(true);
	Object.defineProperty(testBrowser.tab, 'url', { value: 'https://shortestpath.cn/problem/dsu/found/A' });
	const read = jest.spyOn(fs.promises, 'readFile');
	const importProblem = jest.fn();
	await runImportCommand(testBrowser, importProblem, folderOpen);
	expect([read.mock.calls.length, importProblem.mock.calls.length, jest.mocked(vscode.window.withProgress).mock.calls.length, jest.mocked(vscode.window.showInformationMessage).mock.calls.length]).toEqual([0, 0, 0, 0]);
	expect(testBrowser.sent[testBrowser.sent.length - 1].params.expression).toBe(shortestPathStartProblemScript());
});

test('unavailable ShortestPath action reports an error without falling back to Companion', async () => {
	const testBrowser = browser(false);
	Object.defineProperty(testBrowser.tab, 'url', { value: 'https://shortestpath.cn/topics' });
	const read = jest.spyOn(fs.promises, 'readFile');
	const importProblem = jest.fn();
	const result = await runImportCommand(testBrowser, importProblem, true);
	expect([read.mock.calls.length, importProblem.mock.calls.length, result, jest.mocked(vscode.window.showErrorMessage).mock.calls]).toEqual([0, 0, { count: 0, error: 'Could not import this page: {0}' }, [['Could not import this page: {0}']]]);
});

test('other OJs still parse and import Companion tasks', async () => {
	const tasks = [{ name: 'A', url: 'https://example.com/A', tests: [] }];
	const testBrowser = browser(tasks);
	jest.spyOn(fs.promises, 'readFile').mockResolvedValue('parse()');
	const importProblem = jest.fn(async () => ({ created: true }));
	await runImportCommand(testBrowser, importProblem, true);
	expect(importProblem.mock.calls).toEqual([[tasks[0]]]);
});

test.each(['invalid', 'script', 'closed'])('rejects %s results and always releases the CDP session', async mode => {
	const testBrowser = browser([{ name: 'invalid' }], mode === 'script', mode === 'closed');
	await expect(parseBrowserProblems(testBrowser.tab, 'parse()')).rejects.toThrow();
	expect([testBrowser.session.close.mock.calls.length, testBrowser.listeners.size, testBrowser.closeListeners.size]).toEqual([1, 0, 0]);
});


afterEach(() => jest.restoreAllMocks());

test.each(['before', 'during'])('navigation %s parsing rejects stale results', async mode => {
	const location = { href: mode === 'before' ? 'https://example.com/B' : 'https://example.com/A' };
	const context = vm.createContext({ location, parse: async () => { location.href = 'https://example.com/B'; return [{ name: 'A', url: 'https://example.com/A', tests: [] }]; } });
	const f = browser(undefined, false, false, expression => vm.runInContext(expression, context));
	await expect(parseBrowserProblems(f.tab, 'parse()', 'https://example.com/A')).rejects.toThrow('page changed');
	expect(f.session.close).toHaveBeenCalledTimes(1);
});

function register(importer: (problem: any) => Promise<{ created: boolean }>) {
	const subscriptions: vscode.Disposable[] = [];
	registerBrowserImport({ subscriptions, extensionPath: '/extension' } as vscode.ExtensionContext, importer);
	const mock = vscode.commands.registerCommand as jest.Mock;
	return mock.mock.calls[mock.mock.calls.length - 1][1] as (tabId?: string, parserId?: string, url?: string) => Promise<BrowserImportResult>;
}

test('browser import reports missing workspace and partial failure without notifications', async () => {
	const f = browser([{ name: 'A', url: 'https://example.com/A', tests: [] }, { name: 'B', url: 'https://example.com/B', tests: [] }]);
	Object.assign(vscode.window, { activeBrowserTab: f.tab, browserTabs: [f.tab] });
	Object.assign(vscode.workspace, { workspaceFolders: [] });
	const importer = jest.fn().mockResolvedValueOnce({ created: true }).mockRejectedValueOnce(new Error('disk full'));
	const command = register(importer);
	expect(await command()).toEqual({ count: 0, error: 'Please open a folder first.' });
	Object.assign(vscode.workspace, { workspaceFolders: [{}] });
	jest.spyOn(fs.promises, 'readFile').mockResolvedValue('Promise.resolve([])');
	expect(await command(f.tab.id, 'ExampleParser', f.tab.url)).toEqual({ count: 1, error: 'Could not import this page: {0}' });
	expect(importer).toHaveBeenCalledTimes(2);
	// The VS Code mock intentionally has no notification or progress APIs.
});

test('cancellation and navigation release the per-tab import lock', async () => {
	const f = browser([{ name: 'A', url: 'https://example.com/A', tests: [] }]);
	Object.assign(vscode.window, { activeBrowserTab: f.tab, browserTabs: [f.tab] });
	Object.assign(vscode.workspace, { workspaceFolders: [{}] });
	jest.spyOn(fs.promises, 'readFile').mockResolvedValue('Promise.resolve([])');
	const importer = jest.fn().mockResolvedValue({ created: false });
	const command = register(importer);
	expect(await command(f.tab.id, 'ExampleParser', 'https://example.com/B')).toEqual({ count: 0, error: 'Could not import this page: {0}' });
	expect(importer).not.toHaveBeenCalled();
	expect(await command(f.tab.id, 'ExampleParser')).toEqual({ count: 0, cancelled: true });
	expect(await command(f.tab.id, 'ExampleParser')).toEqual({ count: 0, cancelled: true });
});


test.each([true, false])('native import %s matched parser chooses automatic or manual parsing', async matched => {
	const choices = [{ id: 'ExampleParser', name: 'Example', patterns: ['https://example.com/*'], matched }];
	const tasks = [{ name: 'A', url: 'https://example.com/A', tests: [] }];
	const f = browser(undefined, false, false, async expression => expression.includes('ShortestPathCompanionInspect()') ? choices : tasks);
	Object.assign(vscode.window, { activeBrowserTab: f.tab, browserTabs: [f.tab] });
	Object.assign(vscode.workspace, { workspaceFolders: [{}] });
	jest.spyOn(fs.promises, 'readFile').mockResolvedValue('runtime');
	(vscode.window.showQuickPick as jest.Mock).mockClear().mockResolvedValue({ parserId: 'ExampleParser' });
	const importer = jest.fn().mockResolvedValue({ created: true });
	expect(await register(importer)()).toEqual({ count: 1 });
	expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(matched ? 0 : 1);
	expect(f.sent.find(message => message.method === 'Runtime.evaluate' && String(message.params.expression).includes('__shortestpathParserId'))?.params.expression).toContain('__shortestpathParserId = "ExampleParser"');
	expect(importer).toHaveBeenCalledWith(tasks[0]);
});

test('manual parser picker cancellation releases the import lock without importing', async () => {
	const f = browser([{ id: 'ExampleParser', name: 'Example', patterns: [], matched: false }]);
	Object.assign(vscode.window, { activeBrowserTab: f.tab, browserTabs: [f.tab] });
	Object.assign(vscode.workspace, { workspaceFolders: [{}] });
	jest.spyOn(fs.promises, 'readFile').mockResolvedValue('runtime');
	(vscode.window.showQuickPick as jest.Mock).mockResolvedValue(undefined);
	const importer = jest.fn();
	const command = register(importer);
	expect(await command()).toEqual({ count: 0, cancelled: true });
	expect(await command()).toEqual({ count: 0, cancelled: true });
	expect(importer).not.toHaveBeenCalled();
});
