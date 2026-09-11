/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { findOpenFileViewColumn, shouldHideProblemPanelWhenSourceCloses } from '../problemPanelLifecycle';

suite('ShortestPath OJ problem panel lifecycle', () => {
	test('finds the source group even when another tab is visible in that group', () => {
		assert.equal(findOpenFileViewColumn('/workspace/a.cpp', [
			{ viewColumn: 1, filePaths: ['/workspace/visible.cpp'] },
			{ viewColumn: 2, filePaths: ['/workspace/a.cpp', '/workspace/visible.md'] },
		]), 2);
	});

	test('hides the problem panel only after its bound source tab closes', () => {
		assert.equal(shouldHideProblemPanelWhenSourceCloses('/workspace/a.cpp', ['/workspace/b.cpp']), true);
		assert.equal(shouldHideProblemPanelWhenSourceCloses('/workspace/a.cpp', ['/workspace/a.cpp', '/workspace/b.cpp']), false);
		assert.equal(shouldHideProblemPanelWhenSourceCloses(undefined, ['/workspace/b.cpp']), false);
	});
});
