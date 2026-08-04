/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isShortestPathUpdateAvailable, parseShortestPathUpdateDocument } from '../../../../contrib/shortestpath/browser/shortestPathUpdate.js';

suite('ShortestPath update check', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses a valid latest update document only', () => {
		assert.deepStrictEqual(parseShortestPathUpdateDocument({
			version: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1',
		}), {
			version: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1',
		});
		assert.strictEqual(parseShortestPathUpdateDocument({ version: '0.2.1', downloadUrl: 'https://example.com/release' }), undefined);
		assert.strictEqual(parseShortestPathUpdateDocument({ version: '0.2.1', downloadUrl: 'https://github.com/example/other/releases/tag/Release-v0.2.1' }), undefined);
		assert.strictEqual(parseShortestPathUpdateDocument({ version: '0.2.2', downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1' }), undefined);
	});

	test('compares semantic release versions', () => {
		assert.strictEqual(isShortestPathUpdateAvailable('0.2.0', '0.2.1'), true);
		assert.strictEqual(isShortestPathUpdateAvailable('0.2.1', '0.2.1'), false);
		assert.strictEqual(isShortestPathUpdateAvailable('0.3.0', '0.2.9'), false);
	});
});
