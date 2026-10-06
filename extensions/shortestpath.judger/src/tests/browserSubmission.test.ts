/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
jest.mock('vscode', () => ({ workspace: { isTrusted: true }, window: { openBrowserTab: jest.fn() } }), { virtual: true });
jest.mock('../preferences', () => ({}));
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
import * as vscode from 'vscode';
import { executeSubmissionScript } from '../browserSubmission';

type Message = { id: number; method: string; sessionId?: string; params: Record<string, unknown> };
function mockBrowser(failScript = false, navigateDuringStatus = false, delayedRun = false) {
	const began = Date.now();
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
			if (message.method === 'Runtime.evaluate') { result = failScript && message.params.awaitPromise ? { exceptionDetails: { exception: { description: 'Script error' } } } : { result: { value: String(message.params.expression).startsWith('window[') ? { state: delayedRun && Date.now() - began < 25000 ? 'waiting' : delayedRun && Date.now() - began < 50000 ? 'running' : 'done' } : true } }; }
			for (const listener of [...listeners]) { listener({ id: message.id, sessionId: message.sessionId, result }); }
		}),
		close: jest.fn(async () => { }),
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
			browser.session.sendMessage.mockImplementation(async () => { });
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

test('VJudge starts filling when the button exists without waiting for full page load', async () => {
	const { vjudgeSubmitScript } = await import('../submissionTemplates');
	const browser = mockBrowser();
	await executeSubmissionScript({ urlTemplate: 'https://vjudge.net/problem/UVA-1', script: vjudgeSubmitScript }, { code: 'int main(){}' });
	const readiness = browser.sent.find(message => message.method === 'Runtime.evaluate')!;
	const expression = String(readiness.params.expression);
	const ready = new Function('location', 'document', `return ${expression};`);
	expect(ready({ href: 'https://vjudge.net/problem/UVA-1' }, { readyState: 'interactive', getElementById: () => ({ disabled: false }) })).toBe(true);
	expect(ready({ href: 'https://vjudge.net/problem/UVA-1' }, { readyState: 'complete', getElementById: () => null })).toBe(false);
	expect(expression).not.toContain('readyState');
});

test('userscripts poll completion immediately without a full-load gate', async () => {
	const browser = mockBrowser();
	await executeSubmissionScript({ urlTemplate: 'https://example.com/submit', script: '// ==UserScript==\n// @name early\n// @match https://example.com/*\n// @run-at document-start\n// @grant none\n// ==/UserScript==\n' }, {});
	const evaluations = browser.sent.filter(message => message.method === 'Runtime.evaluate');
	expect(evaluations).toHaveLength(1);
	expect(String(evaluations[0].params.expression)).toMatch(/^window\[/);
});

test('plain custom scripts can run once DOM parsing finishes', async () => {
	const browser = mockBrowser();
	await executeSubmissionScript({ urlTemplate: 'https://example.com', script: 'fill()' }, {});
	const expression = String(browser.sent.find(message => message.method === 'Runtime.evaluate')!.params.expression);
	const ready = new Function('location', 'document', `return ${expression};`);
	expect(ready({ href: 'https://example.com' }, { readyState: 'interactive' })).toBe(true);
	expect(ready({ href: 'https://example.com' }, { readyState: 'loading' })).toBe(false);
	expect(ready({ href: 'about:blank' }, { readyState: 'complete' })).toBe(false);
});

test('custom idle scripts retain separate load and execution time budgets', async () => {
	jest.useFakeTimers();
	try {
		const browser = mockBrowser(false, false, true);
		const result = executeSubmissionScript({ urlTemplate: 'https://example.com/submit', script: '// ==UserScript==\n// @name slow idle\n// @match https://example.com/*\n// @run-at document-idle\n// @grant none\n// ==/UserScript==\n' }, {});
		const assertion = expect(result).resolves.toBeUndefined();
		await jest.advanceTimersByTimeAsync(50100);
		await assertion;
		expect(browser.session.close).toHaveBeenCalledTimes(1);
		expect(browser.listeners.size + browser.closeListeners.size).toBe(0);
	} finally { jest.useRealTimers(); }
});
