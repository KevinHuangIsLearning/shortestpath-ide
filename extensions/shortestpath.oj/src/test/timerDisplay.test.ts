/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { formatElapsedTimer, getNextElapsedTimerUpdateDelay } from '../timerDisplay';

suite('ShortestPath OJ elapsed timer display', () => {
	test('shows an overflow marker only after five hours', () => {
		assert.equal(formatElapsedTimer(5 * 60 * 60 * 1000), '05:00:00');
		assert.equal(formatElapsedTimer(5 * 60 * 60 * 1000 + 1), '05:00:00+');
	});

	test('aligns the next repaint with the next elapsed second', () => {
		assert.equal(getNextElapsedTimerUpdateDelay(125_000), 1000);
		assert.equal(getNextElapsedTimerUpdateDelay(125_999), 1);
	});
});
