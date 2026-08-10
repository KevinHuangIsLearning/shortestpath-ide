/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ConfirmResult } from '../../../../../platform/dialogs/common/dialogs.js';
import { isShortestPathUpdateAvailable, isShortestPathVersionSupported, parseShortestPathUpdateDocument } from '../../../../contrib/shortestpath/browser/shortestPathUpdate.js';
import { ShortestPathUpdateRequiredInput } from '../../../../contrib/shortestpath/browser/shortestPathUpdateRequiredInput.js';

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

	test('parses a minimum supported version', () => {
		assert.deepStrictEqual(parseShortestPathUpdateDocument({
			version: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1',
			minimumSupportedVersion: '0.2.0',
		}), {
			version: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1',
			minimumSupportedVersion: '0.2.0',
		});
		assert.strictEqual(parseShortestPathUpdateDocument({
			version: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1',
			minimumSupportedVersion: 'newest',
		}), undefined);
		assert.strictEqual(parseShortestPathUpdateDocument({
			version: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1',
			minimumSupportedVersion: '0.2.2',
		}), undefined);
	});

	test('compares semantic release versions', () => {
		assert.strictEqual(isShortestPathUpdateAvailable('0.2.0', '0.2.1'), true);
		assert.strictEqual(isShortestPathUpdateAvailable('0.2.1', '0.2.1'), false);
		assert.strictEqual(isShortestPathUpdateAvailable('0.3.0', '0.2.9'), false);
		assert.strictEqual(isShortestPathVersionSupported('0.2.0', '0.2.0'), true);
		assert.strictEqual(isShortestPathVersionSupported('0.1.9', '0.2.0'), false);
	});

	test('does not allow the required update editor to close', async () => {
		const input = new ShortestPathUpdateRequiredInput('0.2.0', 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1');
		try {
			assert.strictEqual(input.closeHandler?.showConfirm(), true);
			assert.strictEqual(await input.closeHandler?.confirm(), ConfirmResult.CANCEL);
		} finally {
			input.dispose();
		}
	});
});
