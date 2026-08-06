/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { TestStorageService } from '../../../common/workbenchTestServices.js';
import {
	getShortestPathOjPrimaryGroupRatio,
	getShortestPathOjPrimaryGroupWidth,
	rememberShortestPathOjPrimaryGroupRatio,
	SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO,
} from '../../../../browser/parts/editor/shortestpathEditorGroupSizing.js';

suite('ShortestPath OJ editor group sizing', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('uses a 6:4 ratio for adjacent groups by default', () => {
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(500, 500), 600);
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(720, 480), 720);
	});

	test('uses the provided ratio when given', () => {
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(500, 500, 0.75), 750);
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(720, 480, 0.5), 600);
	});

	test('does not resize groups without a usable width', () => {
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(0, 0), undefined);
	});

	test('falls back to the default ratio without a stored value', () => {
		const storageService = store.add(new TestStorageService());
		assert.strictEqual(getShortestPathOjPrimaryGroupRatio(storageService), SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO);
	});

	test('remembers the ratio and reads it back', () => {
		const storageService = store.add(new TestStorageService());
		rememberShortestPathOjPrimaryGroupRatio(storageService, 0.7);
		assert.strictEqual(getShortestPathOjPrimaryGroupRatio(storageService), 0.7);
	});

	test('clamps out-of-range ratios when remembering', () => {
		const storageService = store.add(new TestStorageService());
		rememberShortestPathOjPrimaryGroupRatio(storageService, 1.5);
		assert.strictEqual(getShortestPathOjPrimaryGroupRatio(storageService), 0.95);
		rememberShortestPathOjPrimaryGroupRatio(storageService, -0.2);
		assert.strictEqual(getShortestPathOjPrimaryGroupRatio(storageService), 0.05);
	});

	test('ignores invalid stored values', () => {
		const storageService = store.add(new TestStorageService());
		storageService.store('shortestpath.oj.primaryGroupRatio', 0, StorageScope.PROFILE, StorageTarget.USER);
		assert.strictEqual(getShortestPathOjPrimaryGroupRatio(storageService), SHORTESTPATH_OJ_PRIMARY_GROUP_RATIO);
	});
});
