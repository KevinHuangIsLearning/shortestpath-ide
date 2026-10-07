/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
jest.mock('../browserImportButton', () => ({ registerBrowserImportButtons: jest.fn() }));
jest.mock('vscode', () => ({ window: {}, workspace: {}, commands: { registerCommand: jest.fn() } }), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
import fs from 'fs';
import vm from 'vm';
import { parseBrowserProblems, registerBrowserImport, BrowserImportResult } from '../browserImport';
import * as vscode from 'vscode';

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
	expect(await command(f.tab.id, undefined, 'https://example.com/B')).toEqual({ count: 0, error: 'Could not import this page: {0}' });
	expect(importer).not.toHaveBeenCalled();
	expect(await command()).toEqual({ count: 0, cancelled: true });
	expect(await command()).toEqual({ count: 0, cancelled: true });
});
