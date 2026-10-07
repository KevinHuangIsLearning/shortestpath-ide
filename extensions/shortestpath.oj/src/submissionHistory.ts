/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SubmissionSnapshot } from './shortestpathOjProtocol';

/** A completed submission kept in the workspace history. Test-point details are intentionally not retained. */
export type SubmissionHistoryEntry = Pick<SubmissionSnapshot, 'submissionId' | 'status' | 'score' | 'maxTimeMs' | 'maxMemoryKB' | 'judgedAt' | 'resultHidden' | 'generation'>;

export function toSubmissionHistoryEntry(snapshot: SubmissionSnapshot): SubmissionHistoryEntry {
	return {
		submissionId: snapshot.submissionId,
		status: snapshot.status,
		score: snapshot.score,
		maxTimeMs: snapshot.maxTimeMs,
		maxMemoryKB: snapshot.maxMemoryKB,
		judgedAt: snapshot.judgedAt,
		...(snapshot.generation !== undefined ? { generation: snapshot.generation } : {}),
		...(snapshot.resultHidden ? { resultHidden: true } : {}),
	};
}

export function isSubmissionHistoryEntry(value: unknown): value is SubmissionHistoryEntry {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const entry = value as Partial<SubmissionHistoryEntry>;
	return typeof entry.submissionId === 'string'
		&& typeof entry.status === 'string'
		&& typeof entry.score === 'number'
		&& typeof entry.maxTimeMs === 'number'
		&& typeof entry.maxMemoryKB === 'number'
		&& (entry.judgedAt === null || typeof entry.judgedAt === 'string');
}

/** Discards any fields that may have been present in an older cache entry. */
export function sanitizeSubmissionHistoryEntry(value: unknown): SubmissionHistoryEntry | undefined {
	if (!isSubmissionHistoryEntry(value)) {
		return undefined;
	}
	return {
		submissionId: value.submissionId,
		status: value.status,
		score: value.score,
		maxTimeMs: value.maxTimeMs,
		maxMemoryKB: value.maxMemoryKB,
		judgedAt: value.judgedAt,
		...(typeof value.generation === 'number' && Number.isInteger(value.generation) && value.generation > 0 ? { generation: value.generation } : {}),
		...(value.resultHidden ? { resultHidden: true } : {}),
	};
}

export function mergeSubmissionHistory(entries: readonly SubmissionHistoryEntry[], entry: SubmissionHistoryEntry): SubmissionHistoryEntry[] {
	return [...entries.filter(item => item.submissionId !== entry.submissionId), entry];
}
