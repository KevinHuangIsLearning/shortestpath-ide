/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

jest.mock('vscode', () => ({
	workspace: { workspaceFolders: [], getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }) },
	window: { showErrorMessage: jest.fn() },
	Uri: { file: (fsPath: string) => ({ fsPath }) },
}), { virtual: true });
jest.mock('../i18n', () => ({ __esModule: true, default: (_: string, value: string) => value }));
jest.mock('../preferences', () => ({ getSaveLocationPref: () => '', getCollectProblemsInRoot: () => false }));

import { applyProblemPatch } from '../problemDocument';
import { buildProblemPatch } from '../webview/frontend/components/ProblemSettings';
import { Problem } from '../types';

type Draft = {
	name: string;
	url: string;
	timeLimit: string;
	memoryLimit: string;
	customCheckerPath: string;
	interactorPath: string;
	compilerCommand: string;
	compilerArgs: string;
	interpreterCommand: string;
	interpreterArgs: string;
};

const draft = (overrides: Partial<Draft> = {}): Draft => ({
	name: 'A',
	url: '',
	timeLimit: '1000',
	memoryLimit: '512',
	customCheckerPath: '',
	interactorPath: '',
	compilerCommand: '',
	compilerArgs: '',
	interpreterCommand: '',
	interpreterArgs: '',
	...overrides,
});

const stored = (): Problem => ({
	name: 'A',
	srcPath: '/tmp/a.cpp',
	url: '',
	timeLimit: 1000,
	memoryLimit: 512,
	tests: [],
	interactive: false,
	group: '',
	customCheckerPath: '/checker',
	interactorPath: '/interactor',
	compilerCommand: 'g++-15',
	compilerArgs: ['-fsanitize=address', '-g'],
	interpreterCommand: 'python3',
	interpreterArgs: ['-u'],
});

test('cleared overrides travel as empty values and are deleted instead of keeping the old value', () => {
	const { patch, errors } = buildProblemPatch(draft());
	expect(errors).toEqual({});
	// This is what actually happens between the webview and the host: undefined
	// properties are dropped by JSON.stringify, empty ones survive.
	const delivered = JSON.parse(JSON.stringify(patch));
	const merged = applyProblemPatch(stored(), delivered);
	for (const key of ['customCheckerPath', 'interactorPath', 'compilerCommand', 'compilerArgs', 'interpreterCommand', 'interpreterArgs']) {
		expect(merged).not.toHaveProperty(key);
	}
});

test('non-empty values still replace the stored overrides', () => {
	const { patch } = buildProblemPatch(draft({ compilerCommand: ' clang++ ', compilerArgs: '["-O2", "-std=c++17"]' }));
	const merged = applyProblemPatch(stored(), JSON.parse(JSON.stringify(patch)));
	expect(merged.compilerCommand).toBe('clang++');
	expect(merged.compilerArgs).toEqual(['-O2', '-std=c++17']);
	expect(merged.interpreterCommand).toBeUndefined();
	expect(merged.interpreterArgs).toBeUndefined();
});

test('undefined fields from in-process callers clear the same way', () => {
	const merged = applyProblemPatch(stored(), { compilerArgs: undefined, compilerCommand: undefined });
	expect(merged).not.toHaveProperty('compilerArgs');
	expect(merged).not.toHaveProperty('compilerCommand');
	expect(merged.interpreterArgs).toEqual(['-u']);
});

test('changing a URL replaces the old imported page binding without changing tests', () => {
	const previous = { ...stored(), url: 'https://example.com/old', browserProblemUrl: 'https://vjudge.net/problem/old' };
	const merged = applyProblemPatch(previous, { url: ' https://example.com/new ' });
	expect({ url: merged.url, bound: merged.browserProblemUrl, tests: merged.tests }).toEqual({
		url: 'https://example.com/new', bound: 'https://example.com/new', tests: previous.tests,
	});
});

test('a local problem can set and clear its statement URL', () => {
	const local = { ...stored(), local: true, url: '/tmp/a.cpp' };
	const linked = applyProblemPatch(local, { url: 'https://example.com/A' });
	expect({ local: linked.local, url: linked.url, bound: linked.browserProblemUrl }).toEqual({
		local: true, url: 'https://example.com/A', bound: 'https://example.com/A',
	});
	const cleared = applyProblemPatch(linked, { url: '' });
	expect({ url: cleared.url, bound: cleared.browserProblemUrl }).toEqual({ url: '', bound: '' });
});

test('unrelated settings retain the imported page binding', () => {
	const problem = { ...stored(), browserProblemUrl: 'https://vjudge.net/problem/A' };
	expect(applyProblemPatch(problem, { name: 'New title', url: problem.url }).browserProblemUrl).toBe(problem.browserProblemUrl);
});

test('invalid argument JSON still reports an error', () => {
	Object.defineProperty(globalThis, 'window', { value: { translations: {} }, configurable: true });
	try {
		const { patch, errors } = buildProblemPatch(draft({ compilerArgs: '-O2' }));
		expect(patch).toBeUndefined();
		expect(errors.compilerArgs).toBe('invalidArgs');
	} finally { delete (globalThis as { window?: unknown }).window; }
});
