/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { describeJudgeType } from '../judgeDisplay';

suite('ShortestPath OJ judge type display', () => {
	test('does not label normal token checkers as special judge', () => {
		assert.equal(describeJudgeType('tokens', null), undefined);
		assert.equal(describeJudgeType('default', null), undefined);
	});

	test('labels float checkers as Float Judge', () => {
		assert.equal(describeJudgeType('float', 1e-6), 'Float Judge');
	});

	test('labels testlib and other special checkers as Special Judge', () => {
		assert.equal(describeJudgeType('testlib', null), 'Special Judge');
		assert.equal(describeJudgeType('custom', null), 'Special Judge');
	});

	test('prefers Float Judge when an unknown checker carries an epsilon', () => {
		assert.equal(describeJudgeType('custom', 1e-3), 'Float Judge');
	});
});
