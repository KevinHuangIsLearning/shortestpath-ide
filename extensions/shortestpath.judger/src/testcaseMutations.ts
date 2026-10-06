/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import { CaseAction, Problem, TestCase } from './types';

export function importProblemTests(problem: Problem, tests: TestCase[], replace: boolean): Problem {
	const merged = replace ? [] : [...problem.tests];
	let id = problem.tests.reduce((max, test) => Math.max(max, test.id), 0);
	for (const test of tests) {
		if ((test.inputPath || test.outputPath) && merged.some(value => value.inputPath === test.inputPath && value.outputPath === test.outputPath)) { continue; }
		const next = { ...test, id: test.id <= id ? ++id : (id = test.id) };
		merged.push(next);
	}
	return { ...problem, tests: merged };
}

export function changeProblemTest(problem: Problem, action: CaseAction, testcase: TestCase): Problem {
	const tests = [...problem.tests];
	const index = tests.findIndex(test => test.id === testcase.id);
	if (index < 0) { return problem; }
	if (action === 'delete') { tests.splice(index, 1); }
	else if (action === 'up' || action === 'down') {
		const target = index + (action === 'up' ? -1 : 1);
		if (target >= 0 && target < tests.length) { [tests[index], tests[target]] = [tests[target], tests[index]]; }
	} else if (action !== 'clear') {
		const next = { ...tests[index] };
		if (action === 'disable') { next.disabled = !next.disabled; }
		else if (action === 'input') { next.input = testcase.input; next.inputPath = testcase.inputPath; }
		else if (action === 'output' || action === 'answer') { next.output = testcase.output; next.outputPath = testcase.outputPath; }
		tests[index] = next;
	}
	return { ...problem, tests };
}
