/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
jest.mock('vscode', () => ({}), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_key: string, text: string) => text }));
import vm from 'vm';
import { browserImportButtonScript } from '../browserImportButton';

function documentFixture(loading = false, subframe = false) {
	const events = new Map<string, () => void>();
	const elements: any[] = [];
	const requests: string[] = [];
	const window: any = { __shortestpathImportProblem: (payload: string) => requests.push(payload) };
	window.top = subframe ? {} : window;
	const document = {
		readyState: loading ? 'loading' : 'complete',
		getElementById: (id: string) => elements.find(element => element.id === id),
		addEventListener: (name: string, listener: () => void) => events.set(name, listener),
		removeEventListener: (name: string, listener: () => void) => { if (events.get(name) === listener) { events.delete(name); } },
		documentElement: { append: (element: any) => elements.push(element) },
		createElement: () => ({ style: {}, setAttribute: jest.fn(), addEventListener(name: string, listener: any) { Object.assign(this, { [name]: listener }); }, attachShadow() { return { append: (button: any) => { Object.assign(this, { button }); } }; }, remove() { const index = elements.indexOf(this); if (index >= 0) { elements.splice(index, 1); } } }),
	};
	const context = vm.createContext({ window, document, location: { protocol: 'https:' } });
	const mount = () => vm.runInContext(browserImportButtonScript('+ Import', 'Import title'), context);
	return { window, elements, events, requests, mount };
}

test('loading document disposal cancels mounting and clears globals', () => {
	const fixture = documentFixture(true);
	fixture.mount(); fixture.mount();
	expect([fixture.events.size, fixture.elements.length]).toEqual([1, 0]);
	fixture.window.__shortestpathImportButtonCleanup();
	fixture.events.get('DOMContentLoaded')?.();
	expect([fixture.events.size, fixture.elements.length, fixture.window.__shortestpathImportButtonBusy, fixture.window.__shortestpathImportButtonCleanup]).toEqual([0, 0, undefined, undefined]);
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
