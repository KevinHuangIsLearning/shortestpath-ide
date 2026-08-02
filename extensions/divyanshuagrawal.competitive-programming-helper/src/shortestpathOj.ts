import { Problem } from './types';

/** Appends an OJ test without replacing user-created CPH tests. */
export function appendShortestPathTestCase(problem: Problem, input: string, output: string, id: number): boolean {
    if (problem.tests.some(test => test.input === input && test.output === output)) {
        return false;
    }
    problem.tests.push({ input, output, id });
    return true;
}
