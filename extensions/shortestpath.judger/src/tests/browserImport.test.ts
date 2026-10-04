/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
jest.mock('vscode', () => ({}), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
import { parseBrowserProblems } from '../browserImport';
import * as vscode from 'vscode';

function browser(value: unknown, scriptError = false, closeDuringParse = false) {
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
			const result = message.method === 'Target.getTargets' ? { targetInfos: [{ type: 'page', targetId: 'page' }] }
				: message.method === 'Target.attachToTarget' ? { sessionId: 'attached' }
				: message.method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } }
				: message.method === 'Page.createIsolatedWorld' ? { executionContextId: 42 }
				: scriptError ? { exceptionDetails: { text: 'parser failed' } } : { result: { value } };
			for (const listener of [...listeners]) { listener({ id: message.id, sessionId: message.sessionId, result }); }
		},
		close: jest.fn(async () => {}),
	};
	const tab = { id: 'browser', startCDPSession: async () => session } as vscode.BrowserTab;
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
