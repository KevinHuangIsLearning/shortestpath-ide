/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import test from 'node:test';
import { getProblemPanelLayout, normalizeProblemSourceRatio } from '../problemPanelLayout';

test('problem panel layout uses the configured source ratio', () => {
	assert.deepStrictEqual(getProblemPanelLayout(70), {
		orientation: 0,
		groups: [{ size: 0.7 }, { size: 0.3 }],
	});
});

test('problem panel layout defaults and clamps invalid ratios', () => {
	assert.strictEqual(normalizeProblemSourceRatio(undefined), 60);
	assert.strictEqual(normalizeProblemSourceRatio(Number.NaN), 60);
	assert.strictEqual(normalizeProblemSourceRatio(5), 10);
	assert.strictEqual(normalizeProblemSourceRatio(95), 90);
});
