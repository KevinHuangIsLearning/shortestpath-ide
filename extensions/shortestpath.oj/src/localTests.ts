/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function isOfficialLocalTest(test: { origin?: string } | undefined): boolean {
	return test?.origin === 'sample';
}

export type LocalTestResult = {
	id: number; pass: boolean | null; stdout: string; stderr: string;
	code: number | null; signal: string | null; time: number; timeOut: boolean;
	outputLimitExceeded?: boolean;
	diff?: { summary: string; lines: Array<{ lineNumber: number; expected: string | null; received: string | null; type: string }> };
	checkerRun?: { stdout: string; stderr: string; code: number | null; timeOut: boolean; signal: string | null };
};
export type LocalTestsSnapshot = {
	runMode?: 'all' | 'single';
	runId?: number;
	runTestId?: number;
	sourcePath: string;
	status: 'idle' | 'compiling' | 'running' | 'checking' | 'stopping';
	activeId?: number;
	diagnostics: string;
	error?: string;
	tests: Array<{ id: number; input: string; output: string; origin?: 'sample' | 'custom'; sampleIndex?: number; result?: LocalTestResult }>;
};
export type LocalTestRequest = {
	sourcePath: string;
	action: 'load' | 'add' | 'update' | 'delete' | 'run' | 'runAll' | 'stop';
	id?: number; input?: string; output?: string; deduplicate?: boolean;
	edits?: Array<{ id: number; input: string; output: string }>;
	samples?: Array<{ input: string; output: string }>;
};

export function readLocalTestsSnapshot(value: unknown): LocalTestsSnapshot | undefined {
	if (!value || typeof value !== 'object') { return undefined; }
	const snapshot = value as LocalTestsSnapshot;
	if (typeof snapshot.sourcePath !== 'string' || typeof snapshot.diagnostics !== 'string' ||
		!['idle', 'compiling', 'running', 'checking', 'stopping'].includes(snapshot.status) || !Array.isArray(snapshot.tests) ||
		!snapshot.tests.every(test => test && Number.isSafeInteger(test.id) && typeof test.input === 'string' && typeof test.output === 'string')) {
		return undefined;
	}
	return snapshot;
}

export function localTestErrorMessage(code: string): string {
	switch (code) {
		case 'tests-running': return '请先停止正在进行的测试。';
		case 'problem-unavailable': return '未找到该文件的本地测试数据。';
		case 'test-unavailable': return '没有可运行的测试用例。';
		case 'compile-failed': return '编译失败';
		case 'run-failed': return '本地测试执行失败';
		case 'invalid-test': return '测试输入或期望输出无效。';
		case 'readonly-test': return '题目自带样例不能修改或删除。';
		case 'interactive-unavailable': return '交互题不支持本地样例运行。';
		default: return '本地测试暂时不可用，请重试。';
	}
}
