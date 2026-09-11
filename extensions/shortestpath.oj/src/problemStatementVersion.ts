/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ImportedProblem, parseProblemBindData } from './shortestpathOjProtocol';

/** The complete imported payload is retained so an old statement is never detached from its own limits, metadata, or website state. */
export type ProblemStatementSnapshot = ImportedProblem;

export function getProblemStatementSnapshot(problem: ImportedProblem): ProblemStatementSnapshot {
	return problem;
}

/** A statement includes its samples, which are rendered in the statement tab. */
export function hasProblemStatementChanged(previous: ImportedProblem, next: ImportedProblem): boolean {
	return JSON.stringify(getProblemStatementFingerprint(previous)) !== JSON.stringify(getProblemStatementFingerprint(next));
}

export function appendPreviousStatementVersion(versions: ProblemStatementSnapshot[], problem: ImportedProblem): ProblemStatementSnapshot[] {
	const snapshot = getProblemStatementSnapshot(problem);
	return versions.some(version => JSON.stringify(version) === JSON.stringify(snapshot)) ? versions : [...versions, snapshot];
}

export function sanitizeProblemStatementVersions(value: unknown): { versions: ProblemStatementSnapshot[]; changed: boolean } {
	if (!Array.isArray(value)) {
		return { versions: [], changed: value !== undefined };
	}
	const versions = value.map(parseProblemStatementSnapshot).filter((version): version is ProblemStatementSnapshot => version !== undefined);
	return { versions, changed: versions.length !== value.length || versions.some((version, index) => JSON.stringify(version) !== JSON.stringify(value[index])) };
}

function parseProblemStatementSnapshot(value: unknown): ProblemStatementSnapshot | undefined {
	if (typeof value !== 'object' || value === null) {
		return undefined;
	}
	const candidate = value as Partial<ImportedProblem>;
	try {
		return parseProblemBindData({ problem: candidate, state: candidate.state, capabilities: candidate.capabilities });
	} catch {
		return undefined;
	}
}

function getProblemStatementFingerprint(problem: ImportedProblem): Pick<ImportedProblem, 'title' | 'url' | 'topic' | 'flags' | 'statement' | 'samples' | 'limits' | 'judge' | 'metadata'> {
	return {
		title: problem.title,
		url: problem.url,
		topic: problem.topic,
		flags: problem.flags,
		statement: problem.statement,
		samples: problem.samples,
		limits: problem.limits,
		judge: problem.judge,
		metadata: problem.metadata,
	};
}
