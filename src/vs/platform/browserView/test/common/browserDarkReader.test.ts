/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { isBrowserDarkReaderEnabled } from '../../common/browserDarkReader.js';

suite('Browser Dark Reader homepage exclusion', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('keeps IDE-owned Home in its native theme when normal browsing uses Dark Reader', () => {
		assert.deepStrictEqual([
			'http://127.0.0.1:4317/?shortestpath-home=1',
			'http://127.0.0.1:4317/releases/1.1.0/index.html?shortestpath-home=1',
			'http://127.0.0.1:3000/',
			'https://example.com/',
		].map(url => isBrowserDarkReaderEnabled(url, { enabled: true, excludedHosts: [] })), [false, false, true, true]);
	});
});
