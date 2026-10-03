/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
jest.mock('vscode', () => ({ workspace: { isTrusted: true }, window: { openBrowserTab: jest.fn() } }), { virtual: true });
jest.mock('../preferences', () => ({}));
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
import * as vscode from 'vscode';
import { executeSubmissionScript } from '../browserSubmission';

type Message = { id: number; method: string; sessionId?: string; params: Record<string, unknown> };
function mockBrowser(failScript = false, navigateDuringStatus = false) {
	const listeners = new Set<(message: unknown) => void>();
	const closeListeners = new Set<() => void>();
	const sent: Message[] = [];
	const session = {
		onDidReceiveMessage: (listener: (message: unknown) => void) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
		onDidClose: (listener: () => void) => { closeListeners.add(listener); return { dispose: () => closeListeners.delete(listener) }; },
		sendMessage: jest.fn(async (message: Message) => {
			sent.push(message);
            if (navigateDuringStatus && message.method === 'Runtime.evaluate' && String(message.params.expression).startsWith('window[')) {
                navigateDuringStatus = false;
                for (const listener of [...listeners]) { listener({ id: message.id, sessionId: message.sessionId, error: { message: 'Execution context was destroyed.' } }); }
                return;
            }
			let result: object = {};
			if (message.method === 'Page.getFrameTree') { result = { frameTree: { frame: { id: 'main' } } }; }
            if (message.method === 'Page.addScriptToEvaluateOnNewDocument') {
                result = { identifier: 'injection' };
                if (message.params.worldName) { for (const listener of [...listeners]) { listener({ method: 'Runtime.executionContextCreated', sessionId: 'attached', params: { context: { id: 8, name: message.params.worldName, origin: 'https://example.com', auxData: { frameId: 'main' } } } }); } }
            }
			if (message.method === 'Target.getTargets') { result = { targetInfos: [{ type: 'page', targetId: 'page' }] }; }
			if (message.method === 'Target.attachToTarget') { result = { sessionId: 'attached' }; }
			if (message.method === 'Runtime.evaluate') { result = failScript && message.params.awaitPromise ? { exceptionDetails: { exception: { description: 'Script error' } } } : { result: { value: String(message.params.expression).startsWith('window[') ? { state: 'done' } : true } }; }
			for (const listener of [...listeners]) { listener({ id: message.id, sessionId: message.sessionId, result }); }
		}),
		close: jest.fn(async () => {}),
	};
	(vscode.window.openBrowserTab as jest.Mock).mockResolvedValue({ startCDPSession: async () => session });
	return { session, sent, listeners, closeListeners };
}

describe('integrated browser script execution', () => {
	test('attaches before navigation and evaluates on attached target; releases listeners', async () => {
		const browser = mockBrowser();
		await executeSubmissionScript({ urlTemplate: 'https://example.com/{problemId}', script: 'fill({code})' }, { problemId: 'A', code: 'a`b\n' });
		expect(vscode.window.openBrowserTab).toHaveBeenCalledWith('about:blank', { modal: true, preserveFocus: false });
		expect(browser.sent.map(message => message.method)).toEqual(['Target.getTargets', 'Target.attachToTarget', 'Page.navigate', 'Runtime.evaluate', 'Runtime.evaluate']);
		expect(browser.sent.slice(2).every(message => message.sessionId === 'attached')).toBe(true);
		expect(browser.sent[4].params.expression).toContain('fill("a`b\\n")');
		expect(browser.session.close).toHaveBeenCalledTimes(1);
		expect(browser.listeners.size + browser.closeListeners.size).toBe(0);
	});
	test('surfaces JavaScript failures and closes CDP while keeping the page', async () => {
		const browser = mockBrowser(true);
		await expect(executeSubmissionScript({ urlTemplate: 'https://example.com', script: 'throw new Error()' }, {})).rejects.toThrow('Script error');
		expect(browser.session.close).toHaveBeenCalledTimes(1);
		expect(browser.listeners.size + browser.closeListeners.size).toBe(0);
	});
	test('a lost CDP response times out and cleans up', async () => {
		jest.useFakeTimers();
		try {
			const browser = mockBrowser();
			browser.session.sendMessage.mockImplementation(async () => {});
			const result = executeSubmissionScript({ urlTemplate: 'https://example.com', script: '' }, {});
			const assertion = expect(result).rejects.toThrow('timed out');
			await jest.advanceTimersByTimeAsync(30001);
			await assertion;
			expect(browser.session.close).toHaveBeenCalledTimes(1);
			expect(browser.listeners.size + browser.closeListeners.size).toBe(0);
		} finally { jest.useRealTimers(); }
	});
});


test('privileged userscripts get a named isolated world, exact-context polling and injection cleanup', async () => {
    globalThis.extensionContext = { globalState: { get: () => ({}) } } as unknown as vscode.ExtensionContext;
    const browser = mockBrowser();
    const script = '// ==UserScript==\n// @name example\n// @match https://example.com/*\n// @grant GM_getValue\n// ==/UserScript==\n';
    await executeSubmissionScript({ urlTemplate: 'https://example.com/submit', script }, { code: 'quoted " code' });
    const registration = browser.sent.find(message => message.method === 'Page.addScriptToEvaluateOnNewDocument')!;
    const binding = browser.sent.find(message => message.method === 'Runtime.addBinding')!;
    const status = browser.sent.find(message => String(message.params.expression).startsWith('window['))!;
    expect([binding.params.executionContextName, status.params.contextId, browser.sent[browser.sent.length - 1]?.method]).toEqual([registration.params.worldName, 8, 'Page.removeScriptToEvaluateOnNewDocument']);
    expect(browser.sent.indexOf(registration)).toBeLessThan(browser.sent.findIndex(message => message.method === 'Page.navigate'));
});


test('userscript status polling survives a navigation destroying its execution context', async () => {
    const browser = mockBrowser(false, true);
    await executeSubmissionScript({ urlTemplate: 'https://example.com/submit', script: '// ==UserScript==\n// @name navigate\n// @match https://example.com/*\n// @grant none\n// ==/UserScript==\n' }, {});
    expect(browser.sent.filter(message => String(message.params.expression).startsWith('window['))).toHaveLength(2);
    expect(browser.session.close).toHaveBeenCalledTimes(1);
});
