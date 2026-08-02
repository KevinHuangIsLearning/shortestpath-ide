/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getShortestPathOjPrimaryGroupWidth } from '../../../../browser/parts/editor/shortestpathEditorGroupSizing.js';

suite('ShortestPath OJ editor group sizing', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('uses a 6:4 ratio for adjacent groups', () => {
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(500, 500), 600);
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(720, 480), 720);
	});

	test('does not resize groups without a usable width', () => {
		assert.strictEqual(getShortestPathOjPrimaryGroupWidth(0, 0), undefined);
	});
});
