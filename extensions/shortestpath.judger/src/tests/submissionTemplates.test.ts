/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { resolveSubmission, submissionUrl, replaceSubmissionPlaceholders, vjudgeSubmitScript } from '../submissionTemplates';
import * as vm from 'vm';
const mapping = { 'codeforces.com': { oj: 'CF', ojName: 'CodeForces', contestIdRegex: '/problem/(\\d+)/', problemIdRegex: '/problem/\\d+/(\\w+)' } };
const vjudge = { CodeForces: { urlTemplate: 'https://codeforces.com/problemset/problem/{contestId}/{problemId}', problemIdRegex: '^(\\d+)(.+)$', compositeFormat: '{contestId}{problemId}', vjudgeUrlKey: 'CodeForces' } };
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
	test('default script opens form, selects personal account, preserves exact code without submitting', async () => {
		const code = 'quotes "\' ` ${globalThis.hacked = true}\n{problemId}\n</script>\\n';
		const actions: string[] = [];
		let filled = '';
		const context = { document: { getElementById: (id: string) => id === 'btn-submit' ? { click: () => actions.push('open') } : undefined, querySelector: (selector: string) => selector === 'label[for="submitter-type1"]' ? { click: () => actions.push('personal') } : selector === '.CodeMirror' ? { CodeMirror: { setValue: (value: string) => { filled = value; } } } : undefined } };
		await vm.runInNewContext(`(async () => { ${replaceSubmissionPlaceholders(vjudgeSubmitScript, { code, problemId: 'A' }, true)} })()`, context);
		expect(actions).toEqual(['open', 'personal']);
		expect(filled).toBe(code);
		expect((context as { hacked?: boolean }).hacked).toBeUndefined();
	});
});
