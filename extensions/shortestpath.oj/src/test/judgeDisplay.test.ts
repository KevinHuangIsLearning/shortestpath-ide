/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { describeFloatJudgeTolerance, describeJudgeType, describeSubmissionDetailStatus, describeSubmissionStage, describeSubmissionStatus } from '../judgeDisplay';

suite('ShortestPath OJ judge type display', () => {
	test('does not label normal token checkers as special judge', () => {
		assert.equal(describeJudgeType('tokens', null), undefined);
		assert.equal(describeJudgeType('default', null), undefined);
	});

	test('labels float checkers as Float Judge', () => {
		assert.equal(describeJudgeType('float', 1e-6), 'Float Judge');
		assert.equal(describeFloatJudgeTolerance(0.000001), '允许的精度误差：0.000001');
	});

	test('labels testlib and other special checkers as Special Judge', () => {
		assert.equal(describeJudgeType('testlib', null), 'Special Judge');
		assert.equal(describeJudgeType('custom', null), 'Special Judge');
	});

	test('prefers Float Judge when an unknown checker carries an epsilon', () => {
		assert.equal(describeJudgeType('custom', 1e-3), 'Float Judge');
	});

	test('does not show waiting after a submission has finished without a stage', () => {
		assert.equal(describeSubmissionStage(undefined, undefined), 'waiting');
		assert.equal(describeSubmissionStage(undefined, 'complete'), undefined);
		assert.equal(describeSubmissionStage('   ', 'unavailable'), undefined);
		assert.equal(describeSubmissionStage('compile', 'complete'), 'compile');
	});

	test('maps common submission results to display colors', () => {
		assert.equal(describeSubmissionStatus('AC'), 'accepted');
		assert.equal(describeSubmissionStatus('Accepted'), 'accepted');
		assert.equal(describeSubmissionStatus('JG'), 'in-progress');
		assert.equal(describeSubmissionStatus('NA'), 'in-progress');
		assert.equal(describeSubmissionStatus('PD'), 'in-progress');
		assert.equal(describeSubmissionStatus('Pending'), 'in-progress');
		assert.equal(describeSubmissionStatus('CE'), 'compilation-error');
		assert.equal(describeSubmissionStatus('Compile Error'), 'compilation-error');
		assert.equal(describeSubmissionStatus('WA'), 'wrong-answer');
		assert.equal(describeSubmissionStatus('Wrong Answer'), 'wrong-answer');
		assert.equal(describeSubmissionStatus('RE'), 'runtime-error');
		assert.equal(describeSubmissionStatus('Runtime Error'), 'runtime-error');
		assert.equal(describeSubmissionStatus('TLE'), 'time-limit-exceeded');
		assert.equal(describeSubmissionStatus('Time Limit Exceeded'), 'time-limit-exceeded');
		assert.equal(describeSubmissionStatus('Memory Limit Exceeded'), 'failed');
	});

	test('renders unjudged test points as a dash without a loading indicator', () => {
		assert.deepEqual(describeSubmissionDetailStatus('NA'), { label: '-' });
		assert.deepEqual(describeSubmissionDetailStatus('na'), { label: '-' });
		assert.deepEqual(describeSubmissionDetailStatus('RE'), { label: 'RE', statusClass: 'runtime-error' });
	});
});
