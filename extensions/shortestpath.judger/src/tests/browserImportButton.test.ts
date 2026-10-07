/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
jest.mock('vscode', () => ({}), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
import vm from 'vm';
import * as vscode from 'vscode';
import { browserImportButtonScript, attachBrowserImportButton } from '../browserImportButton';

class Element {
	width = 200; height = 100;
	id = ''; title = ''; className = ''; textContent = ''; value = ''; hidden = false; disabled = false;
	style = { right: '20px', top: '20px', setProperty(key: string, value: string) { Object.assign(this, { [key]: value }); } }; children: Element[] = []; attributes = new Map<string, string>(); events = new Map<string, (event: any) => void>();
	constructor(public tag: string, private elements: Element[]) { elements.push(this); }
	setAttribute(key: string, value: string) { this.attributes.set(key, value); }
	addEventListener(key: string, callback: (event: any) => void) { this.events.set(key, callback); }
	append(...children: Element[]) { this.children.push(...children); }
	replaceChildren() { this.children = []; }
	attachShadow() { return new Element('shadow', this.elements); }
	remove() { this.elements.splice(this.elements.indexOf(this), 1); }
	focus() { }
	getBoundingClientRect() { return { width: this.width, height: this.height }; }
	setPointerCapture() { }
	querySelector() { return this.children.find(child => child.tag === 'button'); }
	fire(name = 'click', trusted = true) { this.events.get(name)?.({ isTrusted: trusted }); }
}
function fixture(matched = true, loading = false, subframe = false) {
	const elements: Element[] = [], requests: string[] = [];
	const events = new Map<string, () => void>();
	const location = { protocol: 'https:', href: 'https://example.com/task' };
	let inspect: (() => void) | undefined;
	const window: any = {
		addEventListener: jest.fn(), removeEventListener: jest.fn(),
		__shortestpathImportProblem: (request: string) => requests.push(request),
		ShortestPathCompanionInspect: () => [{ id: 'ExampleParser', name: 'Example', patterns: ['https://example.com/*'], matched }, { id: 'OtherParser', name: 'Other', patterns: ['https://other.com/*'], matched: false }],
	};
	window.top = subframe ? {} : window;
	const document = {
		readyState: loading ? 'loading' : 'complete', documentElement: new Element('html', elements),
		createElement: (tag: string) => new Element(tag, elements),
		addEventListener: (key: string, callback: () => void) => events.set(key, callback),
		removeEventListener: (key: string) => events.delete(key),
	};
	const context = vm.createContext({ window, document, location, URL, innerWidth: 900, innerHeight: 700, CSSStyleSheet: class { replaceSync() { } }, setInterval: (callback: () => void) => { inspect = callback; return 1; }, clearInterval: jest.fn(), setTimeout: jest.fn(), clearTimeout: jest.fn() });
	const mount = (initiallyCollapsed = false) => vm.runInContext(browserImportButtonScript('+ Add', 'Choose', '', initiallyCollapsed), context);
	const find = (name: string) => elements.find(element => element.className === name)!;
	return { window, elements, requests, events, mount, find, location, inspect: () => inspect?.(), match: () => { matched = true; }, unmatch: () => { matched = false; } };
}

test('default entry is a top-right plus that opens the picker without an automatic match', () => {
	const f = fixture(false);
	f.mount(true);
	const host = f.elements.find(element => element.id === 'shortestpath-import-button')!;
	expect([host.style, f.find('bar').children.filter(child => !child.hidden).map(child => child.textContent)])
		.toEqual([expect.objectContaining({ cssText: expect.stringContaining('top:20px!important') }), ['+']]);
	f.find('toggle').fire();
	expect([f.find('panel').hidden, f.find('list').children.length]).toEqual([false, 2]);
});

test('loading cleanup prevents mount; duplicate scripts and subframes do not mount', () => {
	const f = fixture(true, true); f.mount(); f.mount();
	expect(f.events.size).toBe(1); f.window.__shortestpathImportButtonCleanup();
	expect([f.events.size, f.window.__shortestpathImportButtonCleanup]).toEqual([0, undefined]);
	const subframe = fixture(true, false, true); subframe.mount(); expect(subframe.find('add')).toBeUndefined();
});

test('matched control rejects synthetic clicks, blocks repeats and renders results', () => {
	const f = fixture(); f.mount(); f.mount(); const add = f.find('add');
	add.fire('click', false); expect(f.requests).toEqual([]);
	add.fire(); add.fire();
	expect(f.requests.map(request => JSON.parse(request))).toEqual([{ action: 'import', parserId: 'ExampleParser', url: f.location.href }]);
	f.window.__shortestpathImportButtonResult({ count: 2, error: 'Failure' }); f.window.__shortestpathImportButtonBusy(false);
	expect([f.find('status').textContent, add.disabled]).toEqual(['Imported 2 problem(s).\nFailure', false]);
});

test('unsupported pages allow searching and manually selecting a parser', () => {
	const f = fixture(false); f.mount(); expect(f.find('add').hidden).toBe(true);
	const input = f.elements.find(element => element.tag === 'input')!;
	input.value = 'other.com'; input.fire('input');
	const list = f.find('list'); expect(list.children).toHaveLength(1); list.children[0].fire();
	f.find('add').fire();
	expect(f.requests.map(request => JSON.parse(request))).toEqual([{ action: 'import', parserId: 'OtherParser', url: f.location.href }]);
	f.window.__shortestpathImportButtonBusy(false);
	f.location.href = 'https://example.com/next'; f.window.__shortestpathImportButtonRefresh(); expect(f.find('add').hidden).toBe(true);
	input.value = 'missing'; input.fire('input'); expect(list.textContent).toBe('No matching parsers.');
});

test('page predicate changes hide the matched action but keep manual selection available', () => {
	const f = fixture(); f.mount(); f.unmatch(); f.inspect();
	expect([f.find('add').hidden, f.find('choose').hidden]).toEqual([true, false]);
});


test('drag handle moves and clamps the control without importing', () => {
	const f = fixture(); f.mount(); const drag = f.find('drag');
	const host = f.elements.find(element => element.id === 'shortestpath-import-button')!;
	drag.events.get('pointerdown')?.({ isTrusted: true, button: 0, pointerId: 1, clientX: 800, clientY: 600, preventDefault() { } });
	drag.events.get('pointermove')?.({ pointerId: 1, clientX: -1000, clientY: -1000 });
	expect([host.style.right, host.style.top, f.requests]).toEqual(['692px', '8px', []]);
	drag.events.get('pointerup')?.({});
	f.window.__shortestpathImportButtonCleanup(); expect(f.window.removeEventListener).toHaveBeenCalledWith('resize', expect.any(Function));
});


test('feedback growing after dragging to a corner stays within the viewport', () => {
	const f = fixture(); f.mount(); const host = f.elements.find(element => element.id === 'shortestpath-import-button')!;
	host.style.right = '692px'; host.style.top = '592px'; host.width = 340; host.height = 300;
	f.window.__shortestpathImportButtonResult({ count: 0, error: 'Long parsing error' });
	expect([host.style.right, host.style.top]).toEqual(['552px', '392px']);
});


test('collapse closes the picker and preserves manual Parser and feedback through background updates', () => {
	const f = fixture(); f.mount(); f.find('list').children[1].fire();
	const toggle = f.find('toggle'); toggle.fire(); f.inspect();
	f.window.__shortestpathImportButtonBusy(true);
	f.window.__shortestpathImportButtonResult({ count: 1, error: 'Failure' });
	f.window.__shortestpathImportButtonBusy(false);
	expect([f.find('add').hidden, f.find('choose').hidden, f.find('status').hidden, f.find('panel').hidden, toggle.attributes.get('aria-expanded'), f.requests]).toEqual([true, true, true, true, 'false', []]);
	toggle.fire();
	expect([f.find('add').hidden, f.find('add').title, f.find('status').hidden, f.find('status').textContent, toggle.attributes.get('aria-expanded')]).toEqual([false, 'Other', false, 'Imported 1 problem(s).\nFailure', 'true']);
});


test('collapsed control is a single button and dragging it does not expand', () => {
	const f = fixture(); f.mount(); const toggle = f.find('toggle'); toggle.fire();
	expect(f.find('bar').children.filter(child => !child.hidden)).toEqual([toggle]);
	toggle.events.get('pointerdown')?.({ isTrusted: true, button: 0, pointerId: 1, clientX: 800, clientY: 600, preventDefault() { } });
	toggle.events.get('pointermove')?.({ pointerId: 1, clientX: 700, clientY: 500 });
	toggle.events.get('pointerup')?.({}); toggle.fire();
	expect([toggle.attributes.get('aria-expanded'), f.requests]).toEqual(['false', []]);
	toggle.fire(); expect(toggle.attributes.get('aria-expanded')).toBe('true');
});


test('successful import automatically collapses to the translucent single entry', () => {
	const f = fixture(); f.mount(); f.window.__shortestpathImportButtonResult({ count: 1 });
	expect([f.find('bar').children.filter(child => !child.hidden).map(child => child.className), f.find('toggle').attributes.get('data-collapsed'), f.find('panel').hidden]).toEqual([['toggle'], 'true', true]);
});


test('collapse requested while document loads applies when the control mounts', () => {
	const f = fixture(true, true); f.mount(); f.window.__shortestpathImportButtonCollapse();
	f.events.get('DOMContentLoaded')?.();
	expect([f.find('toggle').attributes.get('aria-expanded'), f.find('bar').children.filter(child => !child.hidden).map(child => child.className)]).toEqual(['false', ['toggle']]);
});


test('concurrent collapse persists into navigation and cleans every script', async () => {
	let listener: (message: object) => void = () => { };
	const sent: { method: string; params: Record<string, any> }[] = [];
	let identifier = 0;
	let finishClose: () => void = () => { };
	const closed = new Promise<void>(resolve => { finishClose = resolve; });
	const session = {
		onDidReceiveMessage: (callback: typeof listener) => { listener = callback; return { dispose() { } }; },
		onDidClose: () => ({ dispose() { } }), close: async () => { finishClose(); },
		sendMessage: async (message: any) => {
			sent.push(message);
			const result = message.method === 'Target.getTargets' ? { targetInfos: [{ type: 'page', targetId: 'page' }] }
				: message.method === 'Target.attachToTarget' ? { sessionId: 'attached' }
					: message.method === 'Page.getFrameTree' ? { frameTree: { frame: { id: 'main' } } }
						: message.method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: String(++identifier) } : {};
			listener({ id: message.id, sessionId: message.sessionId, result });
		}
	};
	const handle = await attachBrowserImportButton({ id: 'tab', startCDPSession: async () => session } as unknown as vscode.BrowserTab, async () => ({ count: 1 }), '', false);
	await Promise.all([handle.collapse(), handle.collapse()]);
	expect(identifier).toBe(2);
	listener({ method: 'Runtime.executionContextCreated', sessionId: 'attached', params: { context: { id: 42, name: 'shortestpath-import-button', auxData: { frameId: 'main' } } } });
	await Promise.resolve();
	expect(sent.filter(message => message.method === 'Page.addScriptToEvaluateOnNewDocument').slice(-1)[0]?.params.source).toContain(', true || window.__shortestpathImportButtonInitiallyCollapsed');
	expect(sent.filter(message => message.method === 'Runtime.evaluate').slice(-1)[0]?.params).toEqual({ expression: 'window.__shortestpathImportButtonInitiallyCollapsed = true; window.__shortestpathImportButtonCollapse?.()', contextId: 42 });
	handle.dispose(); await closed;
	expect(sent.filter(message => message.method === 'Page.removeScriptToEvaluateOnNewDocument').map(message => message.params.identifier).sort()).toEqual(['1', '2']);
});

test.each([
	'https://shortestpath.cn/topics',
	'https://shortestpath.cn/problem/dsu/found/A',
	'https://www.shortestpath.cn/upsolving/id/123',
	'https://shortestpath.cn/replay/team-1/A',
])('ShortestPath pages do not inject import controls: %s', url => {
	const f = fixture();
	f.location.href = url;
	f.mount(); f.mount();
	expect([f.elements.map(element => element.tag), f.events.size, f.requests, f.window.__shortestpathImportButtonCleanup])
		.toEqual([['html'], 0, [], undefined]);
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
	const disposable = await attachBrowserImportButton({ id: 'browser', url: 'https://shortestpath.cn/topics', startCDPSession: async () => session } as vscode.BrowserTab, jest.fn(), '', false);
	emit({ sessionId: 'attached', method: 'Page.navigatedWithinDocument', params: { frameId: 'child' } });
	emit({ sessionId: 'another', method: 'Page.navigatedWithinDocument', params: { frameId: 'main' } });
	expect(evaluations).toEqual([]);
	emit({ sessionId: 'attached', method: 'Page.navigatedWithinDocument', params: { frameId: 'main' } });
	expect(evaluations).toEqual(['window.__shortestpathImportButtonRefresh?.()']);
	disposable.dispose();
	await new Promise(resolve => setImmediate(resolve));
	expect([session.close.mock.calls.length, listeners.size, closedListeners.size]).toEqual([1, 0, 0]);
});
