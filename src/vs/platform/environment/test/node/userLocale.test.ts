/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { resolveUserLocale } from '../../node/userLocale.js';

suite('UserLocale', () => {

	test('command-line locale wins over the persisted locale', () => {
		assert.strictEqual(resolveUserLocale('DE', 'en', 'zh-cn'), 'de');
	});

	test('persisted locale wins over the system language', () => {
		assert.strictEqual(resolveUserLocale(undefined, 'EN', 'zh-cn'), 'en');
	});

	test('first launch follows the system language', () => {
		assert.deepStrictEqual(
			['ZH-CN', 'ZH-TW', 'EN-US', 'DE'].map(systemLocale => resolveUserLocale(undefined, undefined, systemLocale)),
			['zh-cn', 'zh-tw', 'en-us', 'de']
		);
	});

	test('empty overrides follow the system language', () => {
		assert.strictEqual(resolveUserLocale('', '', 'EN-US'), 'en-us');
	});

	test('ignores malformed persisted locale values', () => {
		for (const value of [true, 42, ['en'], { language: 'en' }]) {
			assert.strictEqual(resolveUserLocale(undefined, value, 'zh-cn'), 'zh-cn');
		}
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
