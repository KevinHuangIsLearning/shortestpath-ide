/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { appendPreviousStatementVersion, hasProblemStatementChanged, sanitizeProblemStatementVersions } from '../problemStatementVersion';
import { parseProblemBindData } from '../shortestpathOjProtocol';
import { bindPayload } from './fixtures';

test('retains the complete old problem when its statement changes', () => {
	const previous = parseProblemBindData(bindPayload);
	const next = {
		...previous,
		statement: { ...previous.statement, description: { format: 'markdown' as const, content: '# 更新后的题目' } },
	};

	assert.equal(hasProblemStatementChanged(previous, next), true);
	assert.deepStrictEqual(appendPreviousStatementVersion([], previous), [previous]);
});

test('does not create a version for state-only updates or duplicate snapshots', () => {
	const previous = parseProblemBindData(bindPayload);
	const stateOnlyUpdate = {
		...previous,
		state: { ...previous.state, progress: { ...previous.state.progress, submitCount: 2 } },
	};

	assert.equal(hasProblemStatementChanged(previous, stateOnlyUpdate), false);
	assert.deepStrictEqual(appendPreviousStatementVersion([previous], previous), [previous]);
});

test('treats title and judging metadata as statement changes', () => {
	const previous = parseProblemBindData(bindPayload);
	assert.equal(hasProblemStatementChanged(previous, { ...previous, title: '更新后的标题' }), true);
	assert.equal(hasProblemStatementChanged(previous, { ...previous, limits: { ...previous.limits, timeMs: 2000 } }), true);
});

test('drops malformed stored versions without discarding complete old problems', () => {
	const previous = parseProblemBindData(bindPayload);
	assert.deepStrictEqual(sanitizeProblemStatementVersions([previous, { statement: {}, samples: [] }]), { versions: [previous], changed: true });
});
