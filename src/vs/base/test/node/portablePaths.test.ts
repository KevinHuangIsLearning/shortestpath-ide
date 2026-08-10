/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../common/utils.js';
import { shouldUsePortableTemp } from '../../node/portablePaths.js';

suite('Portable paths', () => {
	test('keeps the Windows system temporary directory when the portable path contains spaces', () => {
		assert.strictEqual(shouldUsePortableTemp('win32', 'D:\\Shortest Path IDE\\data\\tmp'), false);
	});

	test('uses the portable temporary directory for a Windows path without spaces', () => {
		assert.strictEqual(shouldUsePortableTemp('win32', 'D:\\ShortestPathIDE\\data\\tmp'), true);
	});

	test('keeps portable temporary directories enabled on non-Windows platforms', () => {
		assert.strictEqual(shouldUsePortableTemp('linux', '/media/Shortest Path IDE/data/tmp'), true);
	});

	ensureNoDisposablesAreLeakedInTestSuite();
});
