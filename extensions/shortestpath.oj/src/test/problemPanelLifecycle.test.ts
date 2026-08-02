/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { findOpenFileViewColumn, shouldRestoreProblemPanel } from '../problemPanelLifecycle';

suite('ShortestPath OJ problem panel lifecycle', () => {
	test('restores a closed problem panel while its source tab remains open', () => {
		assert.equal(shouldRestoreProblemPanel(
			'/workspace/a.cpp',
			'/workspace/a.cpp',
			false,
			['/workspace/a.cpp'],
		), true);
	});

	test('does not restore after the source tab closes or the problem changes', () => {
		assert.equal(shouldRestoreProblemPanel(
			'/workspace/a.cpp',
			'/workspace/a.cpp',
			false,
			[],
		), false);
		assert.equal(shouldRestoreProblemPanel(
			'/workspace/a.cpp',
			'/workspace/b.cpp',
			false,
			['/workspace/a.cpp'],
		), false);
	});

	test('does not create a duplicate when another panel already exists', () => {
		assert.equal(shouldRestoreProblemPanel(
			'/workspace/a.cpp',
			'/workspace/a.cpp',
			true,
			['/workspace/a.cpp'],
		), false);
	});

	test('finds the source group even when another tab is visible in that group', () => {
		assert.equal(findOpenFileViewColumn('/workspace/a.cpp', [
			{ viewColumn: 1, filePaths: ['/workspace/visible.cpp'] },
			{ viewColumn: 2, filePaths: ['/workspace/a.cpp', '/workspace/visible.md'] },
		]), 2);
	});
});
