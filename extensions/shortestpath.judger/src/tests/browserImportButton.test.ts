/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
jest.mock('vscode', () => ({}), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
import vm from 'vm';
import { attachBrowserImportButton, browserImportButtonScript } from '../browserImportButton';
import * as vscode from 'vscode';

function documentFixture(loading = false, subframe = false, url = 'https://example.com/') {
	const events = new Map<string, () => void>();
	const elements: any[] = [];
	const requests: string[] = [];
	const window: any = { __shortestpathImportProblem: (payload: string) => requests.push(payload) };
	window.addEventListener = (name: string, listener: () => void) => events.set(name, listener);
	window.removeEventListener = (name: string) => events.delete(name);
	window.top = subframe ? {} : window;
	const nativeButtons: { disabled: boolean; title: string; getAttribute(name: string): string | null }[] = [];
	const document = {
		readyState: loading ? 'loading' : 'complete',
		getElementById: (id: string) => elements.find(element => element.id === id),
		querySelectorAll: () => nativeButtons,
		addEventListener: (name: string, listener: () => void) => events.set(name, listener),
		removeEventListener: (name: string, listener: () => void) => { if (events.get(name) === listener) { events.delete(name); } },
		documentElement: { append: (element: any) => elements.push(element) },
		createElement: () => {
			const attributes = new Map<string, string>();
			return { style: {}, getAttribute: (name: string) => attributes.get(name), setAttribute: jest.fn((name: string, value: string) => attributes.set(name, value)), addEventListener(name: string, listener: any) { (this as any)[name] = listener; }, attachShadow() { return { append: (button: any) => { (this as any).button = button; } }; }, remove() { const index = elements.indexOf(this); if (index >= 0) { elements.splice(index, 1); } } };
		},
	};
	let refresh = () => {};
	const disconnect = jest.fn();
	class MutationObserver {
		constructor(callback: () => void) { refresh = callback; }
		observe() {}
		disconnect() { disconnect(); }
	}
	const location = { href: url, protocol: new URL(url).protocol };
	const context = vm.createContext({ window, document, location, URL, MutationObserver });
	const mount = () => vm.runInContext(browserImportButtonScript('+ Import', 'Import title'), context);
	return { window, elements, events, requests, nativeButtons, location, disconnect, refresh: () => refresh(), mount };
}

test('loading document disposal cancels mounting and clears globals', () => {
	const fixture = documentFixture(true);
	fixture.mount(); fixture.mount();
	expect([fixture.events.size, fixture.elements.length]).toEqual([1, 0]);
	fixture.window.__shortestpathImportButtonCleanup();
	fixture.events.get('DOMContentLoaded')?.();
	expect([fixture.events.size, fixture.elements.length, fixture.window.__shortestpathImportButtonBusy, fixture.window.__shortestpathImportButtonCleanup]).toEqual([0, 0, undefined, undefined]);
});

test('ShortestPath SPA shows the overlay only on details with a native start control', () => {
	const fixture = documentFixture(false, false, 'https://shortestpath.cn/topics');
	fixture.mount();
	expect(fixture.elements).toHaveLength(0);
	fixture.location.href = 'https://shortestpath.cn/problem/dsu/found/A';
	fixture.window.__shortestpathImportButtonRefresh();
	expect(fixture.elements).toHaveLength(0);
	let label = '开始做题';
	const native = { disabled: false, title: '', getAttribute: () => label };
	fixture.nativeButtons.push(native); fixture.refresh();
	const button = fixture.elements[0].button;
	expect([fixture.elements.length, button.title, button.disabled]).toEqual([1, '开始做题', false]);
	button.setAttribute.mockClear(); fixture.refresh(); fixture.refresh();
	expect(button.setAttribute).not.toHaveBeenCalled();
	label = '正在连接 IDE…'; native.disabled = true; fixture.refresh();
	button.click({ isTrusted: true });
	expect([button.disabled, button.title, fixture.requests]).toEqual([true, label, []]);
	label = '继续做题'; native.disabled = false; fixture.refresh();
	button.click({ isTrusted: true });
	expect([button.disabled, button.title, fixture.requests]).toEqual([false, label, ['import']]);
	fixture.location.href += '/editorial'; fixture.window.__shortestpathImportButtonRefresh();
	expect(fixture.elements).toHaveLength(0);
	fixture.location.href = 'https://shortestpath.cn/replay/team-1/A'; fixture.events.get('popstate')?.();
	expect(fixture.elements).toHaveLength(1);
	fixture.location.href += '#rank'; fixture.events.get('hashchange')?.();
	expect(fixture.elements).toHaveLength(0);
	fixture.location.href = 'https://shortestpath.cn/problem/dsu/found/B'; fixture.window.__shortestpathImportButtonRefresh();
	fixture.nativeButtons.length = 0; fixture.refresh();
	expect(fixture.elements).toHaveLength(0);
	fixture.window.__shortestpathImportButtonCleanup();
	expect([fixture.disconnect.mock.calls.length, fixture.events.size, fixture.window.__shortestpathImportButtonRefresh]).toEqual([1, 0, undefined]);
});

test('other OJ overview pages keep the general import button', () => {
	const fixture = documentFixture(false, false, 'https://codeforces.com/contest/2078'); fixture.mount();
	expect([fixture.elements.length, fixture.elements[0].button.title]).toEqual([1, 'Import title']);
});

test('same-document CDP navigation refreshes the main-frame overlay and cleanup detaches', async () => {
	const listeners = new Set<(message: object) => void>();
	const closedListeners = new Set<() => void>();
	const evaluations: string[] = [];
	const emit = (message: object) => { for (const listener of listeners) { listener(message); } };
	const session = {
		onDidReceiveMessage: (listener: (message: object) => void) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
		onDidClose: (listener: () => void) => { closedListeners.add(listener); return { dispose: () => closedListeners.delete(listener) }; },
		close: jest.fn(async () => {}),
		async sendMessage(raw: unknown) {
			const message = raw as { id: number; method: string; sessionId?: string; params: { expression?: string } };
			if (message.params.expression) { evaluations.push(message.params.expression); }
			const result = message.method === 'Target.getTargets' ? { targetInfos: [{ type: 'page', targetId: 'page' }] }
				: message.method === 'Target.attachToTarget' ? { sessionId: 'attached' }
				: message.method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } }
				: message.method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'script' } : {};
			emit({ id: message.id, sessionId: message.sessionId, result });
			if (message.method === 'Page.addScriptToEvaluateOnNewDocument') {
				emit({ sessionId: 'attached', method: 'Runtime.executionContextCreated', params: { context: { id: 42, name: 'shortestpath-import-button', auxData: { frameId: 'main' } } } });
			}
		},
	};
	const disposable = await attachBrowserImportButton({ id: 'browser', url: 'https://shortestpath.cn/topics', startCDPSession: async () => session } as vscode.BrowserTab, jest.fn());
	emit({ sessionId: 'attached', method: 'Page.navigatedWithinDocument', params: { frameId: 'child' } });
	emit({ sessionId: 'another', method: 'Page.navigatedWithinDocument', params: { frameId: 'main' } });
	expect(evaluations).toEqual([]);
	emit({ sessionId: 'attached', method: 'Page.navigatedWithinDocument', params: { frameId: 'main' } });
	expect(evaluations).toEqual(['window.__shortestpathImportButtonRefresh?.()']);
	disposable.dispose();
	await new Promise(resolve => setImmediate(resolve));
	expect([session.close.mock.calls.length, listeners.size, closedListeners.size]).toEqual([1, 0, 0]);
});

test('top-frame button rejects synthetic clicks and blocks clicks while busy', () => {
	const fixture = documentFixture(); fixture.mount(); fixture.mount();
	expect(fixture.elements).toHaveLength(1);
	const button = fixture.elements[0].button;
	button.click({ isTrusted: false });
	fixture.window.__shortestpathImportButtonBusy(true); button.click({ isTrusted: true });
	expect(fixture.requests).toEqual([]);
	fixture.window.__shortestpathImportButtonBusy(false); button.click({ isTrusted: true });
	expect(fixture.requests).toEqual(['import']);
	fixture.window.__shortestpathImportButtonCleanup(); expect(fixture.elements).toEqual([]);
	const frame = documentFixture(false, true); frame.mount(); expect(frame.elements).toEqual([]);
});
