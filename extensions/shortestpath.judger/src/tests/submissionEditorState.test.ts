/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { parseUserScript, userScriptBootstrap } from '../userScripts';

const code = 'int main() {\n\treturn 0;\n}\n';
function run(name: string, url: string, values: Record<string, string>, globals: Record<string, unknown>) {
	const window: Record<string, unknown> = {};
	window.top = window;
	const source = fs.readFileSync(path.resolve(__dirname, '../../static/userscripts', `${name}.user.js`), 'utf8');
	vm.runInNewContext(userScriptBootstrap(parseUserScript(source), { code, ...values }, 'status'), {
		window, URL, location: new URL(url), Date, setTimeout,
		sessionStorage: { getItem: () => null, setItem: () => {} }, ...globals,
	});
	return window;
}
class Control {
	private currentValue = '';
	disabled = false;
	options: { value: string }[] = [];
	onChange: () => void = () => {};
	get value() { return this.currentValue; }
	set value(value: string) { this.currentValue = value; }
	dispatchEvent() { this.onChange(); }
}

describe('submission editor and form state', () => {
	afterEach(() => jest.useRealTimers());

	test.each(['true', 'false'])('AtCoder fills both editor modes without toggling them (autoSubmit=%s)', async autoSubmit => {
		jest.useFakeTimers();
		jest.setSystemTime(0);
		const textarea = new Control();
		let aceValue = 'draft';
		const submitted: string[] = [];
		const window = run('atcoder', 'https://atcoder.jp/contests/abc001/submit', { autoSubmit }, {
			HTMLTextAreaElement: Control, HTMLInputElement: Control, Event: class {},
			document: { querySelector: (selector: string) => {
				if (selector === '#plain-textarea') { return textarea; }
				if (selector === '#submit') { return { click: () => submitted.push(aceValue, textarea.value) }; }
				return null;
			} },
		});
		window.jQuery = () => ({ data: () => Date.now() >= 500 ? { setValue: (value: string) => { aceValue = value; } } : undefined });
		await jest.advanceTimersByTimeAsync(700);
		expect({ status: window.status, aceValue, textarea: textarea.value, submitted }).toEqual({
			status: { state: 'done' }, aceValue: code, textarea: code, submitted: autoSubmit === 'true' ? [code, code] : [],
		});
	});

	test.each(['both', 'only-main', 'only-sub', 'default'])('Hydro synchronizes controlled language selectors in %s layout', async layout => {
		jest.useFakeTimers();
		jest.setSystemTime(0);
		const hidden = new Control();
		const textarea = new Control();
		const main = new Control();
		main.options = [{ value: 'cpp' }, { value: 'python' }];
		main.value = layout === 'only-sub' ? 'cpp' : 'python';
		const sub = new Control();
		sub.options = [{ value: '17' }, { value: '20' }];
		sub.value = '17';
		hidden.options = [...(layout === 'only-sub' ? [] : [{ value: 'python.17' }]), { value: 'cpp.17' }, ...(layout === 'only-main' ? [] : [{ value: 'cpp.20' }])];
		const selectors = layout === 'only-sub' ? [sub] : layout === 'only-main' ? [main] : [main, sub];
		const sync = () => { hidden.value = main.value + '.' + sub.value; };
		main.onChange = () => { setTimeout(() => { sub.value = '17'; sync(); }, 20); };
		sub.onChange = () => { setTimeout(sync, 20); };
		// Simulate React's mount effect overriding the server's named field.
		hidden.value = 'stale';
		setTimeout(sync, 250);
		const submitted: string[] = [];
		const window = run('hydro', 'https://hydro.ac/p/1/submit', {
			languageValue: layout === 'default' ? '' : layout === 'only-main' ? 'cpp.17' : 'cpp.20', autoSubmit: 'true',
		}, {
			HTMLTextAreaElement: Control, HTMLInputElement: Control, HTMLSelectElement: Control, Event: class {},
			document: { querySelector: (selector: string) => {
				if (selector === '#codelang-selector') {
					return Date.now() >= 100 ? { querySelector: () => selectors[0], querySelectorAll: () => selectors } : null;
				}
				if (selector === 'select[name="lang"]') { return hidden; }
				if (selector === 'textarea[name="code"]') { return textarea; }
				if (selector === 'input[type="submit"]') { return { click: () => submitted.push(hidden.value, textarea.value) }; }
				return null;
			} },
		});
		await jest.advanceTimersByTimeAsync(1000);
		expect({ status: window.status, submitted }).toEqual({
			status: { state: 'done' }, submitted: [layout === 'default' ? 'python.17' : layout === 'only-main' ? 'cpp.17' : 'cpp.20', code],
		});
	});

	test.each(['0', '1', '2'])('VJudge handles submission method %s without silently archiving code', async method => {
		jest.useFakeTimers();
		jest.setSystemTime(0);
		let model = 'draft';
		let source = '';
		const submitted: string[] = [];
		const window = run('vjudge', 'https://vjudge.net/problem/POJ-1000', { autoSubmit: 'true' }, {
			document: { querySelector: (selector: string) => {
				if (selector === '#submitModal input[name="submitterType"]:checked') { return { value: method }; }
				if (selector === '#btn-submit') { return { click: () => {} }; }
				if (selector === '#submitModal .CodeMirror') {
					return Date.now() >= 300 ? { CodeMirror: {
						setValue: (value: string) => { model = value; }, save: () => { source = model; },
					} } : null;
				}
				if (selector === '#submitModal #btn-submit') { return { click: () => submitted.push(source) }; }
				return null;
			} },
		});
		await jest.advanceTimersByTimeAsync(500);
		expect({ status: window.status, submitted }).toEqual(method === '2' ? {
			status: { state: 'error', message: 'Error: VJudge is set to archive an existing submission. Choose a code submission method, then submit manually.' }, submitted: [],
		} : { status: { state: 'done' }, submitted: [code] });
	});
});
