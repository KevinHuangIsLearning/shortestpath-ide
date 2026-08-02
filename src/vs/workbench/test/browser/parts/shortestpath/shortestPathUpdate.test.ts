/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getShortestPathUpdateCheckDelay, isShortestPathUpdateAvailable, parseShortestPathRelease, SHORTESTPATH_UPDATE_CHECK_INTERVAL } from '../../../../contrib/shortestpath/browser/shortestPathUpdate.js';

suite('ShortestPath update check', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses stable release tags only', () => {
		assert.deepStrictEqual(parseShortestPathRelease({ tag_name: 'Release-v0.2.1', html_url: 'https://example.com/release', draft: false, prerelease: false }), {
			version: '0.2.1',
			downloadUrl: 'https://example.com/release',
		});
		assert.strictEqual(parseShortestPathRelease({ tag_name: 'Beta-v0.2.1', html_url: 'https://example.com/release', draft: false, prerelease: true }), undefined);
	});

	test('compares semantic release versions', () => {
		assert.strictEqual(isShortestPathUpdateAvailable('0.2.0', '0.2.1'), true);
		assert.strictEqual(isShortestPathUpdateAvailable('0.2.1', '0.2.1'), false);
		assert.strictEqual(isShortestPathUpdateAvailable('0.3.0', '0.2.9'), false);
	});

	test('schedules the next automatic check after a successful check', () => {
		assert.strictEqual(getShortestPathUpdateCheckDelay(0, 1000), 10000);
		assert.strictEqual(getShortestPathUpdateCheckDelay(1000, 1000), SHORTESTPATH_UPDATE_CHECK_INTERVAL);
		assert.strictEqual(getShortestPathUpdateCheckDelay(1000, 1000 + SHORTESTPATH_UPDATE_CHECK_INTERVAL), 10000);
	});
});
