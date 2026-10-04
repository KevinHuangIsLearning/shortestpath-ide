/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import vm from 'vm';
import {
	parseUserScript,
	matchesUserScript,
	userScriptBootstrap,
} from '../userScripts';
const header =
	'// ==UserScript==\n// @name test\n// @match https://*.example.com/submit*\n// @exclude *private*\n// @run-at document-start\n// @grant none\n// ==/UserScript==\n';
describe('submission userscripts', () => {
	test('matches root and subdomains, rejects lookalikes and excludes', () => {
		const script = parseUserScript(header);
		expect(
			[
				'https://example.com/submit',
				'https://www.example.com/submit?q=1',
				'https://fakeexample.com/submit',
				'https://example.com/submit?private',
			].map((url) => matchesUserScript(script, url)),
		).toEqual([true, true, false, false]);
	});
	test('bootstrap is standalone, safely transports code, and runs once across navigation', async () => {
		const storage = new Map<string, string>();
		const source = parseUserScript(
			header +
				'unsafeWindow.result = Judger.code; unsafeWindow.count = (unsafeWindow.count || 0) + 1;',
		);
		const code = '` ${evil()} </script>\n{code}';
		const window: Record<string, unknown> = {};
		window.top = window;
		const context = vm.createContext({
			window,
			location: { href: 'https://example.com/submit' },
			URL,
			sessionStorage: {
				getItem: (key: string) => storage.get(key),
				setItem: (key: string, value: string) =>
					storage.set(key, value),
			},
			document: { readyState: 'complete' },
		});
		const bootstrap = userScriptBootstrap(source, { code }, 'test-key');
		vm.runInContext(bootstrap, context);
		await new Promise((resolve) => setImmediate(resolve));
		delete window['test-key'];
		vm.runInContext(bootstrap, context);
		await new Promise((resolve) => setImmediate(resolve));
		expect([window.result, window.count, window['test-key']]).toEqual([
			code,
			1,
			{ state: 'done' },
		]);
	});
});

 test.each(['document-end', 'document-idle'] as const)('preserves custom %s timing', async runAt => {
    const callbacks = new Map<string, () => void>();
    const window: Record<string, unknown> = { addEventListener: (event: string, callback: () => void) => callbacks.set(event, callback) };
    window.top = window;
    const document = { readyState: 'loading', addEventListener: (event: string, callback: () => void) => callbacks.set(event, callback) };
    const context = vm.createContext({ window, document, URL, location: { href: 'https://example.com/submit' }, sessionStorage: { getItem: () => null, setItem: () => {} } });
    vm.runInContext(userScriptBootstrap(parseUserScript(header.replace('document-start', runAt) + 'window.ran = true;'), {}, 'timing'), context);
    expect(window.ran).toBeUndefined();
    callbacks.get(runAt === 'document-end' ? 'DOMContentLoaded' : 'load')!();
    await new Promise(resolve => setImmediate(resolve));
    expect(window.ran).toBe(true);
    expect(window.timing).toEqual({ state: 'done' });
});
