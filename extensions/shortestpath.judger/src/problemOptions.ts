/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import { Language, Problem } from './types';

/** Argument arrays keep quoting unambiguous and never invoke a shell. */
export function problemLanguage(language: Language, problem: Problem): Language {
    return { ...language,
        compiler: problem.compilerCommand?.trim() || language.compiler,
        args: problem.compilerArgs ?? language.args,
        interpreter: problem.interpreterCommand?.trim() || undefined,
        interpreterArgs: problem.interpreterArgs,
    };
}

export function effectiveTimeLimit(problem: Problem, fallback: number): number {
    return Number.isFinite(problem.timeLimit) && problem.timeLimit > 0 ? problem.timeLimit : fallback;
}
