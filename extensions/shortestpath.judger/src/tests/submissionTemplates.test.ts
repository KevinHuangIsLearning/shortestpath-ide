/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { resolveSubmission, submissionUrl, replaceSubmissionPlaceholders, vjudgeSubmitScript } from '../submissionTemplates';
import * as vm from 'vm';
import * as fs from 'fs';
import * as path from 'path';
import { nativeChinese } from '../nativeTranslations';
const mapping = { 'codeforces.com': { oj: 'CF', ojName: 'CodeForces', contestIdRegex: '/problem/(\\d+)/', problemIdRegex: '/problem/\\d+/(\\w+)' } };
const vjudge = { CodeForces: { urlTemplate: 'https://codeforces.com/problemset/problem/{contestId}/{problemId}', problemIdRegex: '^(\\d+)(.+)$', compositeFormat: '{contestId}{problemId}', vjudgeUrlKey: 'CodeForces' } };

describe('submission method prompt', () => {
	async function submit(configured: string, selection?: number) {
		const showQuickPick = jest.fn(async (items: { value: string }[]) => selection === undefined ? undefined : items[selection]);
		const executeCommand = jest.fn();
		const fillBrowserSubmission = jest.fn();
		const storeSubmitProblem = jest.fn();
		const extensionToJudgeViewMessage = jest.fn();
		const context = vm.createContext({
			URL,
			vscode: { window: { showQuickPick }, commands: { executeCommand } },
			preferences_1: { getDefaultSubmitMethod: () => configured },
			i18n_1: { default: (key: string, text: string) => nativeChinese[key] || text },
			browserSubmission_1: { logSubmission() { }, fillBrowserSubmission },
			companion_1: { storeSubmitProblem },
			message: { command: 'submitWithChoice', problem: { url: 'https://codeforces.com/problemset/problem/1/A' } },
			provider: { currentProblem: {}, extensionToJudgeViewMessage },
		});
		const source = fs.readFileSync(path.resolve(__dirname, '../webview/JudgeView.js'), 'utf8');
		const start = source.indexOf('case \'submitWithChoice\':');
		const end = source.indexOf('case \'submitCf\':', start);
		expect(start >= 0 && end > start).toBe(true);
		await vm.runInContext(`(async function () { switch (message.command) { ${source.slice(start, end)} } }).call(provider)`, context);
		return { showQuickPick, executeCommand, fillBrowserSubmission, storeSubmitProblem, extensionToJudgeViewMessage };
	}

	test('settings choice opens the exact preference, ends submission and clears its busy state', async () => {
		const result = await submit('ask', 2);
		expect(result.showQuickPick.mock.calls[0][0]).toContainEqual({ label: '不想每次询问，去设置', value: 'settings' });
		expect(result.executeCommand).toHaveBeenCalledWith('workbench.action.openSettings', '@id:judger.general.defaultSubmitMethod');
		expect([result.fillBrowserSubmission.mock.calls.length, result.storeSubmitProblem.mock.calls.length, result.extensionToJudgeViewMessage.mock.calls]).toEqual([0, 0, [[{ command: 'submit-finished' }]]]);
	});

	test.each([[0, 1, 0], [1, 0, 1], [undefined, 0, 0]])('ordinary choice %s preserves submission behavior', async (selection, vjudgeCalls, nativeCalls) => {
		const result = await submit('ask', selection);
		expect([result.executeCommand.mock.calls.length, result.fillBrowserSubmission.mock.calls.length, result.storeSubmitProblem.mock.calls.length]).toEqual([0, vjudgeCalls, nativeCalls]);
	});

	test.each(['vjudge', 'native'])('fixed preference %s skips the prompt', async method => {
		const result = await submit(method);
		expect(result.showQuickPick).not.toHaveBeenCalled();
		expect(result.executeCommand).not.toHaveBeenCalled();
	});
});

describe('browser submission templates', () => {
	test('mapped OJ has a default route independent of display preferences', () => {
		const result = resolveSubmission('https://codeforces.com/problemset/problem/2078/A', mapping, vjudge, {})!;
		expect(submissionUrl(result.template.urlTemplate, result.values)).toBe('https://vjudge.net/problem/CodeForces-2078A');
	});
	test('custom script for an alias overrides default and works without VJudge', () => {
		const custom = { cf: { urlTemplate: 'https://codeforces.com/contest/{contestId}/submit', script: 'fill({code})' } };
		expect(resolveSubmission('https://codeforces.com/problemset/problem/2078/A', mapping, {}, custom)?.template).toBe(custom.cf);
	});
	test('VJudge URL override and direct import resolve correctly', () => {
		const result = resolveSubmission('https://vjudge.net/problem/CodeForces-2078A', mapping, { CF: vjudge.CodeForces }, {})!;
		expect(result.values.contestId).toBe('2078');
		expect(result.values.problemId).toBe('A');
		expect(submissionUrl(result.template.urlTemplate, result.values)).toBe('https://vjudge.net/problem/CodeForces-2078A');
	});
	test('does not route lookalike hosts and unsupported OJs', () => {
		expect(resolveSubmission('https://fakecodeforces.com/problem/1/A', mapping, vjudge, {})).toBeUndefined();
		expect(resolveSubmission('https://example.com/problem/1', mapping, vjudge, {})).toBeUndefined();
	});
	test('URL values are encoded once and inserted placeholders stay literal', () => {
		expect(submissionUrl('https://example.com/{problemId}?oj={oj}', { problemId: 'A/B?#', oj: '{problemId}' })).toBe('https://example.com/A%2FB%3F%23?oj=%7BproblemId%7D');
		expect(() => submissionUrl('javascript:alert(1)', {})).toThrow();
		expect(() => submissionUrl('https://example.com/{missing}', {})).toThrow();
	});
	test('default VJudge script rejects an unavailable personal-account method', async () => {
		let filled = false;
		const context = {
			document: {
				getElementById: () => ({ click: () => { } }),
				querySelector: (selector: string) => selector === '#submitModal .CodeMirror'
					? { CodeMirror: { setValue: () => { filled = true; } } }
					: selector === '#submitModal #submitter-type1' ? { disabled: true } : undefined,
			}
		};
		await expect(vm.runInNewContext(`(async () => { ${replaceSubmissionPlaceholders(vjudgeSubmitScript, { code: 'source' }, true)} })()`, context)).rejects.toThrow('personal-account submission is unavailable');
		expect(filled).toBe(false);
	});
	test('default script opens form, selects personal account, preserves exact code without submitting', async () => {
		const code = 'quotes "\' ` ${globalThis.hacked = true}\n{problemId}\n</script>\\n';
		const actions: string[] = [];
		let filled = '';
		const context = { document: { getElementById: (id: string) => id === 'btn-submit' ? { click: () => actions.push('open') } : undefined, querySelector: (selector: string) => selector === '#submitModal label[for="submitter-type1"]' ? { click: () => actions.push('personal') } : selector === '#submitModal #submitter-type1' ? { disabled: false } : selector === '#submitModal .CodeMirror' ? { CodeMirror: { save: () => actions.push('save'), setValue: (value: string) => { filled = value; } } } : undefined } };
		await vm.runInNewContext(`(async () => { ${replaceSubmissionPlaceholders(vjudgeSubmitScript, { code, problemId: 'A' }, true)} })()`, context);
		expect(actions).toEqual(['open', 'personal', 'save']);
		expect(filled).toBe(code);
		expect((context as { hacked?: boolean }).hacked).toBeUndefined();
	});
});
