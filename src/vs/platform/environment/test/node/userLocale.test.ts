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

	test('persisted locale wins over the product default', () => {
		assert.strictEqual(resolveUserLocale(undefined, 'EN', 'zh-cn'), 'en');
	});

	test('uses the product default when no locale is persisted', () => {
		assert.strictEqual(resolveUserLocale(undefined, undefined, 'ZH-CN'), 'zh-cn');
	});

	test('ignores malformed persisted locale values', () => {
		for (const value of [true, 42, ['en'], { language: 'en' }]) {
			assert.strictEqual(resolveUserLocale(undefined, value, 'zh-cn'), 'zh-cn');
		}
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
