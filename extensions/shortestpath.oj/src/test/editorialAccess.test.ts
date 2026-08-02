/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { canRequestEditorial, shouldConfirmEditorial } from '../editorialAccess';
import { parseProblemBindData } from '../shortestpathOjProtocol';
import { bindPayload } from './fixtures';

const importedProblem = parseProblemBindData(bindPayload);

suite('ShortestPath OJ editorial access', () => {
	test('only blocks an editorial request while the webpage is disconnected', () => {
		assert.equal(canRequestEditorial(false), false);
		assert.equal(canRequestEditorial(true), true);
	});

	test('does not request confirmation after the problem is accepted', () => {
		assert.equal(shouldConfirmEditorial(importedProblem), true);
		assert.equal(shouldConfirmEditorial({
			...importedProblem,
			state: {
				...importedProblem.state,
				timer: { ...importedProblem.state.timer, accepted: true },
			},
		}), false);
	});
});
