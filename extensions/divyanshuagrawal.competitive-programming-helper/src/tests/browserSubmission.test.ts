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
function mockBrowser(failScript = false) {
	const listeners = new Set<(message: unknown) => void>();
	const closeListeners = new Set<() => void>();
	const sent: Message[] = [];
	const session = {
		onDidReceiveMessage: (listener: (message: unknown) => void) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
		onDidClose: (listener: () => void) => { closeListeners.add(listener); return { dispose: () => closeListeners.delete(listener) }; },
		sendMessage: jest.fn(async (message: Message) => {
			sent.push(message);
			let result: object = {};
			if (message.method === 'Target.getTargets') { result = { targetInfos: [{ type: 'page', targetId: 'page' }] }; }
			if (message.method === 'Target.attachToTarget') { result = { sessionId: 'attached' }; }
			if (message.method === 'Runtime.evaluate') { result = failScript && message.params.awaitPromise ? { exceptionDetails: { exception: { description: 'Script error' } } } : { result: { value: true } }; }
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
