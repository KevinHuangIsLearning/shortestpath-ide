/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Problem } from '../../types';

/** A source file rebound to a different problem must show its own hint. */
export function dropHintProblemKey(problem: Pick<Problem, 'srcPath' | 'url'>): string {
	return JSON.stringify([problem.srcPath, problem.url]);
}

export function dismissProblemDropHint(dismissed: readonly string[] = [], problem: Pick<Problem, 'srcPath' | 'url'>): string[] {
	return [...new Set([...dismissed, dropHintProblemKey(problem)])];
}
