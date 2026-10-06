/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import { getProblem, saveProblem } from './parser';
import { CaseAction, CaseMode, RunResult, TestCase } from './types';
import { testcaseAction } from './testcaseActions';
import { changeProblemTest, importProblemTests } from './testcaseMutations';

export async function persistTestcaseAction(srcPath: string, id: number, action: CaseAction, mode?: CaseMode, result?: RunResult | null) {
	const original = getProblem(srcPath);
	if (!original) { return; }
	const change = await testcaseAction(original, id, action, mode, result);
	const current = getProblem(srcPath);
	if (!change || !current) { return; }
	const problem = changeProblemTest(current, change.action, change.testcase);
	saveProblem(srcPath, problem);
	return { change, problem };
}

export function persistImportedTests(srcPath: string, tests: TestCase[], replace: boolean) {
	const current = getProblem(srcPath);
	if (!current) { return; }
	const problem = importProblemTests(current, tests, replace);
	saveProblem(srcPath, problem);
	return problem;
}
