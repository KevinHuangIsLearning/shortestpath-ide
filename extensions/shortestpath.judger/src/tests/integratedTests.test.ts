/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IntegratedTestDependencies, IntegratedTestService, IntegratedTestsSnapshot, usesIntegratedTests, preserveIntegratedTests, areTokenOutputsEqual } from '../integratedTests';
import { Problem, RunResult } from '../types';

function setup() {
	const problems = new Map<string, Problem>();
	for (const sourcePath of ['/A.cpp', '/B.cpp']) {
		problems.set(sourcePath, { srcPath: sourcePath, url: 'https://shortestpath.cn/problem/DSU/found/A', name: 'A', interactive: false, memoryLimit: 256, timeLimit: 1000, group: 'DSU', tests: [{ id: 1, input: '1', output: '1' }, { id: 2, input: '2', output: '2' }] });
	}
	const published: IntegratedTestsSnapshot[] = [];
	const result = (id: number): RunResult => ({ id, pass: true, stdout: String(id), stderr: '', code: 0, signal: null, time: 3, timeOut: false });
	const deps: IntegratedTestDependencies = {
		read: path => problems.get(path) ?? null,
		write: jest.fn(problem => problems.set(problem.srcPath, problem)),
		compile: jest.fn(async () => true),
		execute: jest.fn(async (_problem, test) => result(test.id)),
		cleanup: jest.fn(), stop: jest.fn(), busy: () => false,
		publish: snapshot => published.push(snapshot),
	};
	const service = new IntegratedTestService(deps);
	return { service, deps, problems, published };
}

test('recognizes ShortestPath imports and preserves the native UI for other judges', () => {
	const { problems } = setup();
	const value = problems.get('/A.cpp')!;
	expect([usesIntegratedTests(value), usesIntegratedTests({ ...value, url: 'https://codeforces.com/contest/1/problem/A' }), usesIntegratedTests({ ...value, url: 'http://localhost:3000/problem/A', shortestPath: true })]).toEqual([true, false, true]);
});

test('integrated comparison ignores whitespace but preserves token boundaries and values', () => {
	expect(areTokenOutputsEqual('1\t2\n3', ' 1  2 3\r\n')).toBe(true);
	expect(areTokenOutputsEqual('', ' \n\t')).toBe(true);
	expect(areTokenOutputsEqual('12', '1 2')).toBe(false);
	expect(areTokenOutputsEqual('1 2', '1 3')).toBe(false);
});

test('snapshots identify bulk and single runs for card expansion behavior', async () => {
	const { service } = setup();
	const all = await service.request({ sourcePath: '/A.cpp', action: 'runAll' });
	expect(all).toMatchObject({ runMode: 'all', runId: 1 });
	const single = await service.request({ sourcePath: '/A.cpp', action: 'run', id: 1 });
	expect(single).toMatchObject({ runMode: 'single', runId: 2, runTestId: 1 });
});

test('reimport preserves edited and deleted tests, settings and IDs while refreshing remote metadata and source path', () => {
	const { problems } = setup();
	const previous = { ...problems.get('/A.cpp')!, tests: [{ id: 42, input: 'user case', output: 'answer' }], customCheckerPath: '/checker.py', largeSampleDirectory: '/samples' };
	const incoming = { ...problems.get('/A.cpp')!, srcPath: '/new/A.cpp', name: 'updated title', timeLimit: 2000 };
	const merged = preserveIntegratedTests(incoming, previous);
	expect(merged).toEqual({ ...previous, ...incoming, tests: previous.tests });
	expect(preserveIntegratedTests(incoming, { ...previous, tests: [] }).tests).toEqual([]);
	expect(preserveIntegratedTests({ ...incoming, url: 'https://shortestpath.cn/problem/DSU/found/B' }, previous)).toBeDefined();
	expect(preserveIntegratedTests({ ...incoming, url: 'https://shortestpath.cn/problem/DSU/found/B' }, previous).tests).toEqual(incoming.tests);
});

test('interactive metadata cannot execute ordinary samples through direct commands', async () => {
	const { service, deps, problems } = setup();
	problems.get('/A.cpp')!.interactive = true;
	await expect(service.request({ sourcePath: '/A.cpp', action: 'runAll' })).rejects.toThrow('interactive-unavailable');
	expect(deps.compile).not.toHaveBeenCalled();
});

test('sample provenance is migrated once and enforced across edits, runs and reimports', async () => {
	const { service, problems } = setup();
	const samples = [{ input: '1', output: '1' }];
	await service.request({ sourcePath: '/A.cpp', action: 'load', samples });
	expect(service.snapshot('/A.cpp').tests[0]).toMatchObject({ origin: 'sample', sampleIndex: 0 });
	await expect(service.request({ sourcePath: '/A.cpp', action: 'update', id: 1, input: 'modified', output: 'modified' })).rejects.toThrow('readonly-test');
	await expect(service.request({ sourcePath: '/A.cpp', action: 'delete', id: 1 })).rejects.toThrow('readonly-test');
	await service.request({ sourcePath: '/A.cpp', action: 'runAll', edits: [{ id: 1, input: 'modified', output: 'modified' }] });
	expect(problems.get('/A.cpp')!.tests[0].input).toBe('1');
	await service.request({ sourcePath: '/A.cpp', action: 'add', input: '1', output: '1' });
	const copy = service.snapshot('/A.cpp').tests[2];
	expect(copy.origin).toBe('custom');
	await service.request({ sourcePath: '/A.cpp', action: 'load', samples });
	await service.request({ sourcePath: '/A.cpp', action: 'update', id: copy.id, input: '1', output: '1' });
	expect(service.snapshot('/A.cpp').tests[2].origin).toBe('custom');
	const current = problems.get('/A.cpp')!;
	expect(preserveIntegratedTests({ ...current, tests: [] }, current).tests).toEqual(current.tests);
	await service.request({ sourcePath: '/A.cpp', action: 'delete', id: copy.id });
});

test('loads existing tests, saves edits and additions, deduplicates counterexamples, and deletes by stable ID', async () => {
	const { service, problems } = setup();
	await service.request({ sourcePath: '/A.cpp', action: 'update', id: 1, input: 'changed', output: '' });
	await service.request({ sourcePath: '/A.cpp', action: 'add', input: 'counterexample', output: 'expected', deduplicate: true });
	await service.request({ sourcePath: '/A.cpp', action: 'add', input: 'counterexample', output: 'expected', deduplicate: true });
	await service.request({ sourcePath: '/A.cpp', action: 'delete', id: 2 });
	expect(problems.get('/A.cpp')!.tests.map(({ input, output }) => ({ input, output }))).toEqual([{ input: 'changed', output: '' }, { input: 'counterexample', output: 'expected' }]);
	expect(service.snapshot('/B.cpp').tests).toHaveLength(2);
});

test('run all saves draft edits before compiling once and executes each test with its source owner', async () => {
	const { service, deps, problems } = setup();
	let savedInput: string | undefined;
	deps.compile = jest.fn(async () => { savedInput = problems.get('/A.cpp')!.tests[0].input; return true; });
	const snapshot = await service.request({ sourcePath: '/A.cpp', action: 'runAll', edits: [{ id: 1, input: 'draft', output: '1' }] });
	expect({ savedInput, compileCount: (deps.compile as jest.Mock).mock.calls.length, runs: (deps.execute as jest.Mock).mock.calls.map(([problem, test]) => [problem.srcPath, test.id]), cleanupCount: (deps.cleanup as jest.Mock).mock.calls.length, status: snapshot.status, passes: snapshot.tests.map(test => test.result?.pass) }).toEqual({ savedInput: 'draft', compileCount: 1, runs: [['/A.cpp', 1], ['/A.cpp', 2]], cleanupCount: 1, status: 'idle', passes: [true, true] });
});

test('running a single test does not run the other tests and rejects a missing ID', async () => {
	const { service, deps } = setup();
	await service.request({ sourcePath: '/A.cpp', action: 'run', id: 2 });
	await expect(service.request({ sourcePath: '/A.cpp', action: 'run' })).rejects.toThrow('test-unavailable');
	expect((deps.execute as jest.Mock).mock.calls.map(([, test]) => test.id)).toEqual([2]);
});

test('switching source cannot redirect a running result, stop another source, mutate active tests or start a competing run', async () => {
	const { service, deps, published } = setup();
	let complete: (value: boolean) => void = () => { throw new Error('not compiling'); };
	deps.compile = () => new Promise(resolve => { complete = resolve; });
	const run = service.request({ sourcePath: '/A.cpp', action: 'runAll' });
	await expect(service.request({ sourcePath: '/B.cpp', action: 'runAll' })).rejects.toThrow('tests-running');
	await expect(service.request({ sourcePath: '/A.cpp', action: 'delete', id: 1 })).rejects.toThrow('tests-running');
	await service.request({ sourcePath: '/B.cpp', action: 'stop' });
	expect(deps.stop).not.toHaveBeenCalled();
	expect(service.snapshot('/B.cpp').status).toBe('idle');
	complete(true); await run;
	expect(published.every(snapshot => snapshot.sourcePath === '/A.cpp')).toBe(true);
});

test('stopping compilation prevents execution and returns to idle with binary cleanup', async () => {
	const { service, deps } = setup();
	let complete: (value: boolean) => void = () => { throw new Error('not compiling'); };
	deps.compile = () => new Promise(resolve => { complete = resolve; });
	const run = service.request({ sourcePath: '/A.cpp', action: 'runAll' });
	await service.request({ sourcePath: '/A.cpp', action: 'stop' });
	complete(false); const snapshot = await run;
	expect({ stopped: (deps.stop as jest.Mock).mock.calls.length, executed: (deps.execute as jest.Mock).mock.calls.length, cleanup: (deps.cleanup as jest.Mock).mock.calls.length, status: snapshot.status, error: snapshot.error }).toEqual({ stopped: 1, executed: 0, cleanup: 1, status: 'idle', error: undefined });
});

test('compile failures stay in the problem results without attempting to execute tests', async () => {
	const { service, deps } = setup();
	deps.compile = async (_problem, diagnostic) => { diagnostic('syntax error'); return false; };
	const snapshot = await service.request({ sourcePath: '/A.cpp', action: 'runAll' });
	expect({ error: snapshot.error, diagnostics: snapshot.diagnostics, status: snapshot.status, executions: (deps.execute as jest.Mock).mock.calls.length }).toEqual({ error: 'compile-failed', diagnostics: 'syntax error', status: 'idle', executions: 0 });
});

test('loading a reimported or externally edited case never reuses a stale result', async () => {
	const { service, problems } = setup();
	await service.request({ sourcePath: '/A.cpp', action: 'run', id: 1 });
	problems.get('/A.cpp')!.tests[0].input = 'reimported';
	expect(service.snapshot('/A.cpp').tests[0].result).toBeUndefined();
});
