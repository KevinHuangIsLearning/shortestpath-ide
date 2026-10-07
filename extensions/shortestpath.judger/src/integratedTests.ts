/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Problem, RunResult, TestCase } from './types';
import { getShortestPathProblemPath } from './shortestpathProblemPath';

export function usesIntegratedTests(problem: Problem | undefined | null): boolean {
	return !!problem && (problem.shortestPath === true || getShortestPathProblemPath(problem.url, problem.name) !== undefined);
}

export function areTokenOutputsEqual(expected: string, actual: string): boolean {
	const left = expected.match(/\S+/g) ?? [];
	const right = actual.match(/\S+/g) ?? [];
	return left.length === right.length && left.every((token, index) => token === right[index]);
}

/** A website reimport refreshes remote metadata without resetting the user's local test set. */
export function preserveIntegratedTests(incoming: Problem, previous: Problem | null): Problem {
	if (!usesIntegratedTests(incoming) || !usesIntegratedTests(previous) || !previous) { return incoming; }
	try {
		const oldUrl = new URL(previous.url);
		const newUrl = new URL(incoming.url);
		if (oldUrl.hostname !== newUrl.hostname || oldUrl.pathname.replace(/\/$/, '') !== newUrl.pathname.replace(/\/$/, '')) { return incoming; }
	} catch { return incoming; }
	return { ...previous, ...incoming, tests: previous.tests.map(test => ({ ...test })) };
}

export type IntegratedTestRequest = {
	sourcePath: string;
	action: 'load' | 'add' | 'update' | 'delete' | 'run' | 'runAll' | 'stop';
	id?: number;
	input?: string;
	output?: string;
	deduplicate?: boolean;
	edits?: TestCase[];
	samples?: Array<{ input: string; output: string }>;
};
export type IntegratedTestsSnapshot = {
	runMode?: 'all' | 'single';
	runId?: number;
	runTestId?: number;
	sourcePath: string;
	status: 'idle' | 'compiling' | 'running' | 'checking' | 'stopping';
	activeId?: number;
	diagnostics: string;
	error?: string;
	tests: Array<TestCase & { result?: RunResult }>;
};
export type IntegratedTestDependencies = {
	read(sourcePath: string): Problem | null;
	write(problem: Problem): void;
	compile(problem: Problem, diagnostic: (text: string) => void, isCancelled: () => boolean): Promise<boolean>;
	execute(problem: Problem, test: TestCase, checking: () => void): Promise<RunResult>;
	cleanup(problem: Problem): void;
	stop(): void;
	busy(): boolean;
	publish(snapshot: IntegratedTestsSnapshot): void;
};

/** A headless owner of editable tests. Each run remains bound to its original source. */
export class IntegratedTestService {
	private readonly results = new Map<string, Map<number, { input: string; output: string; result: RunResult }>>();
	private readonly messages = new Map<string, { diagnostics: string; error?: string; runMode?: 'all' | 'single'; runId?: number; runTestId?: number }>();
	private runId = 0;
	private active: { sourcePath: string; status: IntegratedTestsSnapshot['status']; id?: number; stopped: boolean } | undefined;

	constructor(private readonly dependencies: IntegratedTestDependencies) { }

	get isRunning(): boolean { return this.active !== undefined; }

	private problem(sourcePath: string): Problem {
		const problem = this.dependencies.read(sourcePath);
		if (!usesIntegratedTests(problem) || !problem || problem.srcPath !== sourcePath) {
			throw new Error('problem-unavailable');
		}
		return { ...problem, tests: problem.tests.map(test => ({ ...test })) };
	}

	snapshot(sourcePath: string): IntegratedTestsSnapshot {
		const problem = this.problem(sourcePath);
		const active = this.active?.sourcePath === sourcePath ? this.active : undefined;
		return {
			sourcePath, status: active?.status ?? 'idle', activeId: active?.id,
			...(this.messages.get(sourcePath) ?? { diagnostics: '' }),
			tests: problem.tests.map(test => {
				const stored = this.results.get(sourcePath)?.get(test.id);
				return { ...test, result: stored?.input === test.input && stored.output === test.output ? stored.result : undefined };
			}),
		};
	}

	private emit(sourcePath: string): void { this.dependencies.publish(this.snapshot(sourcePath)); }

	async request(request: IntegratedTestRequest): Promise<IntegratedTestsSnapshot> {
		const { sourcePath, action } = request;
		const problem = this.problem(sourcePath);
		if (action === 'load') {
			if (request.samples && (!Array.isArray(request.samples) || !request.samples.every(sample => sample && typeof sample.input === 'string' && typeof sample.output === 'string'))) { throw new Error('invalid-test'); }
			// Legacy files did not record provenance. Classify them once, then
			// persist the identity so later edits or duplicate content cannot change it.
			if (request.samples && problem.tests.some(test => !test.origin)) {
				const used = new Set(problem.tests.filter(test => test.origin === 'sample').map(test => test.sampleIndex));
				for (const test of problem.tests) {
					if (test.origin) { continue; }
					const index = request.samples.findIndex((sample, index) => !used.has(index) && sample.input === test.input && sample.output === test.output);
					test.origin = index < 0 ? 'custom' : 'sample';
					if (index >= 0) { test.sampleIndex = index; used.add(index); }
				}
				this.dependencies.write(problem);
			}
			return this.snapshot(sourcePath);
		}
		if (action === 'stop') {
			if (this.active?.sourcePath === sourcePath) {
				this.active.stopped = true;
				this.active.status = 'stopping';
				this.dependencies.stop();
				this.emit(sourcePath);
			}
			return this.snapshot(sourcePath);
		}
		if (this.active?.sourcePath === sourcePath) { throw new Error('tests-running'); }
		if (action === 'run' || action === 'runAll') {
			if (problem.interactive) { throw new Error('interactive-unavailable'); }
			if (action === 'run' && (!Number.isSafeInteger(request.id) || !problem.tests.some(test => test.id === request.id))) { throw new Error('test-unavailable'); }
			if (this.active || this.dependencies.busy()) { throw new Error('tests-running'); }
			if (request.edits !== undefined) {
				if (!Array.isArray(request.edits) || !request.edits.every(edit => edit && Number.isSafeInteger(edit.id) && typeof edit.input === 'string' && typeof edit.output === 'string' && problem.tests.some(test => test.id === edit.id))) { throw new Error('invalid-test'); }
				for (const edit of request.edits) {
					const test = problem.tests.find(test => test.id === edit.id)!;
					if (test.origin === 'sample') { continue; }
					test.input = edit.input; test.output = edit.output;
                    delete test.inputPath; delete test.outputPath;
				}
				this.dependencies.write(problem);
			}
			await this.run(problem, action === 'run' ? request.id : undefined);
		} else {
			const index = problem.tests.findIndex(test => test.id === request.id);
			if ((action === 'update' || action === 'delete') && problem.tests[index]?.origin === 'sample') { throw new Error('readonly-test'); }
			if (action === 'add' || action === 'update') {
				if (typeof request.input !== 'string' || typeof request.output !== 'string') { throw new Error('invalid-test'); }
				if (action === 'add') {
					if (!request.deduplicate || !problem.tests.some(test => test.input === request.input && test.output === request.output)) {
						let id = Date.now();
						while (problem.tests.some(test => test.id === id)) { id++; }
						problem.tests.push({ id, input: request.input, output: request.output, origin: 'custom' });
					}
				} else {
					if (index < 0) { throw new Error('test-unavailable'); }
					problem.tests[index] = { ...problem.tests[index], input: request.input, output: request.output, inputPath: undefined, outputPath: undefined };
					this.results.get(sourcePath)?.delete(problem.tests[index].id);
				}
			} else if (action === 'delete') {
				if (index < 0) { throw new Error('test-unavailable'); }
				problem.tests.splice(index, 1);
				this.results.get(sourcePath)?.delete(request.id!);
			} else {
				throw new Error('invalid-action');
			}
			this.dependencies.write(problem);
			this.emit(sourcePath);
		}
		return this.snapshot(sourcePath);
	}

	private async run(problem: Problem, id: number | undefined): Promise<void> {
		if (this.active || this.dependencies.busy()) { throw new Error('tests-running'); }
		const tests = problem.tests.filter(test => !test.disabled && (id === undefined || test.id === id));
		if (!tests.length) { throw new Error('test-unavailable'); }
		const active = this.active = { sourcePath: problem.srcPath, status: 'compiling' as IntegratedTestsSnapshot['status'], stopped: false, id: undefined as number | undefined };
		const message = { diagnostics: '', error: undefined as string | undefined, runMode: id === undefined ? 'all' as const : 'single' as const, runId: ++this.runId, runTestId: id };
		this.messages.set(problem.srcPath, message);
		let results = this.results.get(problem.srcPath);
		if (!results) { results = new Map(); this.results.set(problem.srcPath, results); }
		for (const test of tests) { results.delete(test.id); }
		this.emit(problem.srcPath);
		try {
			const compiled = await this.dependencies.compile(problem, text => {
				// Bound compiler diagnostics just as execution output is bounded.
				message.diagnostics = (message.diagnostics + text).slice(0, 1_000_000);
			}, () => active.stopped);
			if (active.stopped) { return; }
			if (!compiled) { message.error = 'compile-failed'; return; }
			for (const test of tests) {
				if (active.stopped) { break; }
				active.status = 'running'; active.id = test.id;
				this.emit(problem.srcPath);
				const result = await this.dependencies.execute(problem, test, () => {
					if (!active.stopped) { active.status = 'checking'; this.emit(problem.srcPath); }
				});
				if (active.stopped) { break; }
				results.set(test.id, { input: test.input, output: test.output, result });
				this.emit(problem.srcPath);
			}
		} catch (error) {
			if (!active.stopped) {
				message.error = 'run-failed';
				message.diagnostics = error instanceof Error ? error.message : String(error);
			}
		} finally {
			try { this.dependencies.cleanup(problem); } finally {
				this.active = undefined;
				this.emit(problem.srcPath);
			}
		}
	}

	dispose(): void { if (this.active) { this.active.stopped = true; this.dependencies.stop(); } }
}
