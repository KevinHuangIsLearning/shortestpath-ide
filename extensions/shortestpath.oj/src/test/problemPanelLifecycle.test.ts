/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { findOpenFileViewColumn, shouldHideProblemPanelWhenSourceCloses, shouldHideProblemPanelWhenSourceInactive, shouldRestoreProblemPanel } from '../problemPanelLifecycle';

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

	test('hides the problem panel when the bound source is no longer active', () => {
		assert.equal(shouldHideProblemPanelWhenSourceInactive('/workspace/a.cpp', '/workspace/a.cpp'), false);
		assert.equal(shouldHideProblemPanelWhenSourceInactive('/workspace/a.cpp', '/workspace/b.cpp'), true);
		assert.equal(shouldHideProblemPanelWhenSourceInactive('/workspace/a.cpp', undefined), true);
		assert.equal(shouldHideProblemPanelWhenSourceInactive(undefined, undefined), false);
	});

	test('hides the problem panel after its inactive source tab closes', () => {
		assert.equal(shouldHideProblemPanelWhenSourceCloses('/workspace/a.cpp', ['/workspace/b.cpp']), true);
		assert.equal(shouldHideProblemPanelWhenSourceCloses('/workspace/a.cpp', ['/workspace/a.cpp', '/workspace/b.cpp']), false);
		assert.equal(shouldHideProblemPanelWhenSourceCloses(undefined, ['/workspace/b.cpp']), false);
	});
});
