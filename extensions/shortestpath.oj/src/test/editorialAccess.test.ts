/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { canRequestEditorial, canViewEditorial, describeEditorialLockReason, getCurrentEditorialRemainingMs, getEditorialConfirmationMessage, shouldConfirmEditorial } from '../editorialAccess';
import { applyAcceptedSubmission, parseProblemBindData } from '../shortestpathOjProtocol';
import { bindPayload } from './fixtures';

const importedProblem = parseProblemBindData(bindPayload);

suite('ShortestPath OJ editorial access', () => {
	test('only blocks an editorial request while the webpage is disconnected', () => {
		assert.equal(canRequestEditorial(false), false);
		assert.equal(canRequestEditorial(true), true);
	});

	test('allows a cached editorial to open while the webpage is disconnected', () => {
		assert.equal(canViewEditorial(false, false), false);
		assert.equal(canViewEditorial(false, true), true);
		assert.equal(canViewEditorial(true, false), true);
	});

	test('requests a neutral confirmation after the problem is accepted', () => {
		assert.equal(shouldConfirmEditorial(importedProblem), true);
		const acceptedProblem = applyAcceptedSubmission(importedProblem, 'AC');
		assert.equal(shouldConfirmEditorial(acceptedProblem), true);
		assert.equal(getEditorialConfirmationMessage(acceptedProblem), '确认查看吗？');
	});

	test('preserves the website confirmation requirement before AC', () => {
		assert.equal(getEditorialConfirmationMessage(importedProblem), importedProblem.state.editorial.confirmationMessage);
		assert.equal(shouldConfirmEditorial({
			...importedProblem,
			state: {
				...importedProblem.state,
				editorial: { ...importedProblem.state.editorial, requiresConfirmation: false },
			},
		}), false);
	});

	test('counts down an editorial lock from the last website response', () => {
		assert.equal(getCurrentEditorialRemainingMs(90_000, 10_000, 40_000), 60_000);
		assert.equal(getCurrentEditorialRemainingMs(90_000, 10_000, 120_000), 0);
		assert.equal(getCurrentEditorialRemainingMs(90_000, 10_000, 5_000), 90_000);
	});

	test('localizes website editorial lock reasons', () => {
		assert.equal(describeEditorialLockReason('state_wait'), '解题报告尚未解锁，');
		assert.equal(describeEditorialLockReason('wait_after_hints'), '查看提示后仍需等待，');
	});
});
