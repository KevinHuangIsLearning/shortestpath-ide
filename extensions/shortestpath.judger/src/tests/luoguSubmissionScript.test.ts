/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { parseUserScript, userScriptBootstrap } from '../userScripts';

const source = fs.readFileSync(path.resolve(__dirname, '../../static/userscripts/luogu.user.js'), 'utf8');

describe('Luogu submission script', () => {
	afterEach(() => jest.useRealTimers());

	test.each(['MacIntel', 'Win32', 'Linux x86_64'].flatMap(platform => ['true', 'false', 'confirm'].map(autoSubmit => [platform, autoSubmit])))('replaces existing editor state on %s (autoSubmit=%s)', async (platform, autoSubmit) => {
		jest.useFakeTimers();
		jest.setSystemTime(0);
		const code = '#include <iostream>\nint main() {\n\tstd::cout << "你好";\n}\n';
		let model = 'old code';
		let selected = false;
		const submitted: string[] = [];
		class ScriptEvent {
			defaultPrevented = false;
			constructor(readonly type: string, readonly options: { metaKey?: boolean; ctrlKey?: boolean; clipboardData?: Transfer } = {}) {}
			preventDefault() { this.defaultPrevented = true; }
		}
		class Transfer {
			private text = '';
			setData(_type: string, value: string) { this.text = value; }
			getData() { return this.text; }
		}
		const editor = {
			disabled: false,
			focus: jest.fn(),
			dispatchEvent: (event: ScriptEvent) => {
				if (event.type === 'keydown') {
					selected = platform === 'MacIntel' ? event.options.metaKey === true : event.options.ctrlKey === true;
					if (selected) { event.preventDefault(); }
				} else if (event.type === 'paste') {
					model = (selected ? '' : model) + event.options.clipboardData!.getData();
					event.preventDefault();
				}
			},
		};
		const main = {
			querySelectorAll: () => [
				{ textContent: '提交文件', disabled: false, click: () => { throw new Error('Wrong button'); } },
				{ textContent: ' 提交评测 ', disabled: Date.now() < 500, click: () => submitted.push(model) },
			],
		};
		const location = new URL('https://www.luogu.com.cn/problem/P1000?contestId=123');
		const window: Record<string, unknown> = {};
		window.top = window;
		const sessionStorage = { getItem: () => null, setItem: () => {} };
		vm.runInNewContext(userScriptBootstrap(parseUserScript(source), { code, autoSubmit: autoSubmit === 'confirm' ? 'true' : autoSubmit, confirmBeforeSubmit: String(autoSubmit === 'confirm') }, 'submission'), {
			window, URL, sessionStorage, location, navigator: { platform }, Date, setTimeout,
			KeyboardEvent: ScriptEvent, ClipboardEvent: ScriptEvent, DataTransfer: Transfer,
			document: { querySelector: (selector: string) => {
				if (location.hash !== '#submit' || Date.now() < 300) { return null; }
				return selector === '.cm-content[contenteditable="true"]' ? editor : selector === 'main' ? main : null;
			} },
		});
		await jest.advanceTimersByTimeAsync(700);
		expect({ status: window.submission, model, submitted, url: location.href, focused: editor.focus.mock.calls.length }).toEqual({
			status: { state: 'done', ...(autoSubmit === 'confirm' ? { canSubmit: true } : {}) }, model: code, submitted: autoSubmit === 'true' ? [code] : [], url: 'https://www.luogu.com.cn/problem/P1000?contestId=123#submit', focused: 1,
		});
	});

	test.each(['false', 'true'].flatMap(autoSubmit => [false, true].map(keyboardHandled => [autoSubmit, keyboardHandled] as const)))('reports unhandled editor events instead of success (autoSubmit=%s, keyboardHandled=%s)', async (autoSubmit, keyboardHandled) => {
		const window: Record<string, unknown> = {};
		window.top = window;
		const sessionStorage = { getItem: () => null, setItem: () => {} };
		vm.runInNewContext(userScriptBootstrap(parseUserScript(source), { code: 'new code', autoSubmit }, 'submission'), {
			window, URL, sessionStorage, location: new URL('https://www.luogu.com.cn/problem/P1000'), navigator: { platform: 'MacIntel' }, Date, setTimeout,
			KeyboardEvent: class { defaultPrevented = keyboardHandled; },
			ClipboardEvent: class { defaultPrevented = false; },
			DataTransfer: class { setData() {} },
			document: { querySelector: () => ({ focus: () => {}, dispatchEvent: () => {}, disabled: false }) },
		});
		await new Promise(resolve => setImmediate(resolve));
		expect(window.submission).toEqual({ state: 'error', message: keyboardHandled ? 'Error: Luogu code editor did not accept the code.' : 'Error: Luogu code editor could not select the existing code.' });
	});
});
