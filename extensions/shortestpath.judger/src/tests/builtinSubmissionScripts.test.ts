/*---------------------------------------------------------------------------------------------
* Part of ShortestPath Judger.
* Licensed under GPL-3.0-or-later. See LICENSE for license information.
*--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { parseUserScript, userScriptBootstrap } from '../userScripts';

const routes = [
	['atcoder', 'https://atcoder.jp/contests/abc/submit'],
	['codeforces', 'https://codeforces.com/contest/123/submit'],
	['codeforces', 'https://codeforces.com/problemset/submit'],
	['hydro', 'https://hydro.ac/p/1/submit'],
	['vjudge', 'https://vjudge.net/problem/UVA-1'],
];

describe('early builtin submission', () => {
	afterEach(() => jest.useRealTimers());
	test.each(
		routes.flatMap(([name, url]) =>
			['true', 'false', 'confirm'].map((autoSubmit) => [name, url, autoSubmit]),
		),
	)(
		'%s fills before page load: %s (autoSubmit=%s)',
		async (name, url, autoSubmit) => {
			jest.useFakeTimers();
			jest.setSystemTime(0);
			const clicks: number[] = [];
			const clickedSelectors: string[] = [];
			const controls = new Map<string, Control>();
			class Control {
				private currentValue = '';
				get value() { return this.currentValue; }
				set value(value: string) { this.currentValue = value; }
				innerText = '';
				style = { display: '' };
				get disabled() {
					return Date.now() < 500;
				}
				get options() {
					return Date.now() >= 700
						? [{ value: 'cpp' }, { value: 'A' }]
						: [];
				}
				get CodeMirror() {
					return Date.now() >= 900
						? {
							save: () => {},
							setValue: (value: string) => {
								this.value = value;
							},
						}
						: undefined;
				}
				querySelector() { return Date.now() >= 700 ? this : null; }
				querySelectorAll() { return Date.now() >= 700 ? [this] : []; }
				getAttribute() {
					return 'true';
				}
				dispatchEvent() {
					return true;
				}
				click() {
					clicks.push(Date.now());
				}
			}
			const document = {
				readyState: 'loading',
				querySelector: (selector: string) => {
					if (selector === '.cf-challenge' || Date.now() < 300) {
						return null;
					}
					if (!controls.has(selector)) {
						const control = new Control();
						if (name === 'hydro') {
							control.value = 'cpp';
							control.dispatchEvent = () => {
								const hidden = document.querySelector('select[name="lang"]');
								if (hidden) { hidden.value = control.value; }
								return true;
							};
						}
						control.click = () => {
							clicks.push(Date.now());
							clickedSelectors.push(selector);
						};
						controls.set(selector, control);
					}
					return controls.get(selector);
				},
			};
			const window: Record<string, unknown> = {};
			window.top = window;
			window.jQuery = (control: Control) => ({ data: () => Date.now() >= 900 ? { setValue: (value: string) => { control.value = value; } } : undefined });
			const storage = new Map<string, string>();
			const source = fs.readFileSync(
				path.resolve(
					__dirname,
					'../../static/userscripts',
					`${name}.user.js`,
				),
				'utf8',
			);
			const script = parseUserScript(source);
			expect(script.runAt).toBe('document-start');
			const context = vm.createContext({
				window,
				document,
				URL,
				location: new URL(url),
				Date,
				setTimeout,
				HTMLTextAreaElement: Control,
				HTMLInputElement: Control,
				HTMLSelectElement: Control,
				Event: class {},
				InputEvent: class {},
				sessionStorage: {
					getItem: (key: string) => storage.get(key),
					setItem: (key: string, value: string) =>
						storage.set(key, value),
				},
			});
			vm.runInContext(
				userScriptBootstrap(
					script,
					{
						code: 'int main(){}',
						languageValue: 'cpp',
						problemId: 'A',
						contestId: '123',
						autoSubmit: autoSubmit === 'confirm' ? 'true' : autoSubmit,
						confirmBeforeSubmit: String(autoSubmit === 'confirm'),
					},
					'submission',
				),
				context,
			);
			await jest.advanceTimersByTimeAsync(1200);
			expect(window.submission).toEqual({ state: 'done', ...(autoSubmit === 'confirm' ? { canSubmit: true } : {}) });
			expect(document.readyState).toBe('loading');
			expect(
				[...controls.values()].some(
					(control) =>
						control.value === 'int main(){}' ||
						control.innerText === 'int main(){}',
				),
			).toBe(true);
			const finalSelector = {
				atcoder: '#submit',
				codeforces: '.submit',
				hydro: 'input[type="submit"]',
				luogu: '#app > div.main-container > div > main > div > div > div.main > div > div.body > button',
				vjudge: '#submitModal #btn-submit',
			}[name];
			expect(
				clickedSelectors.filter(
					(selector) => selector === finalSelector,
				),
			).toHaveLength(autoSubmit === 'true' ? 1 : 0);
			expect(clicks.every((time) => time >= 500)).toBe(true);
			if (autoSubmit === 'confirm') {
				await vm.runInContext('window.submission_submit()', context);
				expect(clickedSelectors.filter(selector => selector === finalSelector)).toHaveLength(1);
			}
			if (name !== 'luogu') {
				expect(
					[...controls.values()].some(
						(control) => control.value === 'cpp',
					),
				).toBe(true);
			}
			if (name === 'codeforces') {
				expect(
					controls.get(
						url.includes('/contest/')
							? 'select[name="submittedProblemIndex"]'
							: 'input[name="submittedProblemCode"]',
					)?.value,
				).toBe(url.includes('/contest/') ? 'A' : '123A');
			}
			if (name === 'vjudge') {
				expect(controls.get('#submitModal .CodeMirror')?.value).toBe('int main(){}');
			}
		},
	);
});
