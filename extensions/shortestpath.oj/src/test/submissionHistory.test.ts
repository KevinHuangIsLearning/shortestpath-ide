/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { isSubmissionHistoryEntry, mergeSubmissionHistory, sanitizeSubmissionHistoryEntry, toSubmissionHistoryEntry } from '../submissionHistory';

suite('ShortestPath OJ submission history', () => {
	test('keeps only the summary fields of a completed submission', () => {
		const entry = toSubmissionHistoryEntry({
			submissionId: '5762',
			language: 'cpp20',
			status: 'AC',
			score: 100,
			maxTimeMs: 13,
			maxMemoryKB: 3664,
			judgedAt: '2026-08-11T08:00:00Z',
			detailState: 'complete',
			details: [{ seq: 1, caseName: 'sample', status: 'AC', timeMs: 13, memoryKB: 3664 }],
		});
		assert.deepStrictEqual(entry, {
			submissionId: '5762',
			status: 'AC',
			score: 100,
			maxTimeMs: 13,
			maxMemoryKB: 3664,
			judgedAt: '2026-08-11T08:00:00Z',
		});
	});

	test('replaces a saved submission with its latest final summary', () => {
		const entries = mergeSubmissionHistory([{ submissionId: '1', status: 'WA', score: 0, maxTimeMs: 4, maxMemoryKB: 1024, judgedAt: '2026-08-11T08:00:00Z' }], { submissionId: '1', status: 'AC', score: 100, maxTimeMs: 5, maxMemoryKB: 2048, judgedAt: '2026-08-11T08:01:00Z' });
		assert.deepStrictEqual(entries, [{ submissionId: '1', status: 'AC', score: 100, maxTimeMs: 5, maxMemoryKB: 2048, judgedAt: '2026-08-11T08:01:00Z' }]);
	});

	test('rejects malformed cached records', () => {
		assert.equal(isSubmissionHistoryEntry({ submissionId: '1', status: 'AC', score: 100, maxTimeMs: 5, maxMemoryKB: 2048, judgedAt: '2026-08-11T08:00:00Z' }), true);
		assert.equal(isSubmissionHistoryEntry({ submissionId: '1', status: 'AC' }), false);
	});

	test('strips old cached details before they are read or written again', () => {
		assert.deepStrictEqual(sanitizeSubmissionHistoryEntry({
			submissionId: '5762', status: 'AC', score: 100, maxTimeMs: 13, maxMemoryKB: 3664, judgedAt: '2026-08-11T08:00:00Z', details: [{ status: 'AC' }], compileErrorMessage: 'do not keep',
		}), {
			submissionId: '5762', status: 'AC', score: 100, maxTimeMs: 13, maxMemoryKB: 3664, judgedAt: '2026-08-11T08:00:00Z',
		});
	});
});
