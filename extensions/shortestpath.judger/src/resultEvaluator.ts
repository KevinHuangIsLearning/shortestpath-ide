/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/
import { CustomCheckerRun } from './types';

/** Testlib status mapping follows CPH-NG's Grader, preserving tool failures. */
export function testlibVerdict(run: Pick<CustomCheckerRun, 'code' | 'signal' | 'timeOut' | 'outputLimitExceeded'>): NonNullable<CustomCheckerRun['verdict']> {
	if (run.timeOut) { return 'TLE'; }
	if (run.signal || run.outputLimitExceeded) { return 'FAIL'; }
	return ({ 0: 'AC', 1: 'WA', 2: 'PE', 3: 'FAIL', 4: 'WA', 7: 'PARTIAL' } as const)[run.code ?? -1] ?? 'FAIL';
}
