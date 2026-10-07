/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
jest.mock('vscode', () => ({}), { virtual: true });
import vm from 'vm';
import * as vscode from 'vscode';
import { browserImportCleanupScript, cleanupBrowserImportButton } from '../browserImportCleanup';

test.each(['https://shortestpath.cn/problem/dsu/found/A', 'https://example.com/task'])('removes only the old IDE control and stops its world cleanup: %s', href => {
	const oldControl = { remove: jest.fn() };
	const nativeStartSolving = { remove: jest.fn(), click: jest.fn() };
	const cleanup = jest.fn();
	const window = { top: undefined as object | undefined, __shortestpathImportButtonCleanup: cleanup };
	window.top = window;
	const document = { getElementById: jest.fn((id: string) => id === 'shortestpath-import-button' ? oldControl : nativeStartSolving) };
	vm.runInNewContext(browserImportCleanupScript(), { window, document, location: { href } });
	expect([cleanup.mock.calls.length, document.getElementById.mock.calls, oldControl.remove.mock.calls.length, nativeStartSolving.remove.mock.calls.length, nativeStartSolving.click.mock.calls.length])
		.toEqual([1, [['shortestpath-import-button']], 1, 0, 0]);
});

test('cleanup is idempotent on clean pages and ignores subframes', () => {
	const document = { getElementById: jest.fn(() => null) };
	const window = { top: undefined as object | undefined };
	window.top = window;
	vm.runInNewContext(browserImportCleanupScript(), { window, document });
	vm.runInNewContext(browserImportCleanupScript(), { window, document });
	window.top = {};
	vm.runInNewContext(browserImportCleanupScript(), { window, document });
	expect(document.getElementById.mock.calls).toEqual([['shortestpath-import-button'], ['shortestpath-import-button']]);
});

test.each([false, true])('migration uses original world and releases session/listeners (CDP failure: %s)', fail => {
	const listeners = new Set<(message: object) => void>();
	const closedListeners = new Set<() => void>();
	const methods: string[] = [];
	const session = {
		onDidReceiveMessage: (listener: (message: object) => void) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
		onDidClose: (listener: () => void) => { closedListeners.add(listener); return { dispose: () => closedListeners.delete(listener) }; },
		close: jest.fn(async () => {}),
		async sendMessage(raw: unknown) {
			const message = raw as { id: number; method: string; sessionId?: string; params: object };
			methods.push(message.method);
			if (message.method === 'Page.createIsolatedWorld') { expect(message.params).toEqual({ frameId: 'main', worldName: 'shortestpath-import-button' }); }
			const result = message.method === 'Target.getTargets' ? { targetInfos: [{ type: 'page', targetId: 'page' }] }
				: message.method === 'Target.attachToTarget' ? { sessionId: 'attached' }
				: message.method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } }
				: message.method === 'Page.createIsolatedWorld' ? { executionContextId: 42 } : {};
			for (const listener of listeners) { listener({ id: message.id, sessionId: message.sessionId, ...(fail && message.method === 'Runtime.evaluate' ? { error: { message: 'navigation' } } : { result }) }); }
		},
	};
	return (async () => {
		const task = cleanupBrowserImportButton({ startCDPSession: async () => session } as unknown as vscode.BrowserTab);
		if (fail) { await expect(task).rejects.toThrow('navigation'); } else { await task; }
		expect([methods, session.close.mock.calls.length, listeners.size, closedListeners.size]).toEqual([
			['Target.getTargets', 'Target.attachToTarget', 'Page.getFrameTree', 'Page.createIsolatedWorld', 'Runtime.evaluate'], 1, 0, 0,
		]);
	})();
});
