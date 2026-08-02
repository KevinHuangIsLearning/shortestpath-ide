/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ImportedProblem } from './shortestpathOjProtocol';

export function canRequestEditorial(connected: boolean): boolean {
	return connected;
}

export function shouldConfirmEditorial(problem: ImportedProblem): boolean {
	return !problem.state.timer.accepted && problem.state.editorial.requiresConfirmation;
}
