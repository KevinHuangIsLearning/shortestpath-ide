/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSettingSupportedOnPlatform, withPlatformSettings } from '../platformSettings';

test('window.systemColorTheme is only written on platforms that register it', () => {
	const settings = { 'workbench.colorTheme': 'One Monokai', 'window.systemColorTheme': 'auto' };
	assert.deepEqual(withPlatformSettings({ ...settings }, 'linux'), { 'workbench.colorTheme': 'One Monokai' });
	assert.deepEqual(withPlatformSettings({ ...settings }, 'win32'), settings);
	assert.deepEqual(withPlatformSettings({ ...settings }, 'darwin'), settings);
	assert.equal(isSettingSupportedOnPlatform('window.systemColorTheme', 'linux'), false);
	assert.equal(isSettingSupportedOnPlatform('window.systemColorTheme', 'win32'), true);
	assert.equal(isSettingSupportedOnPlatform('workbench.colorTheme', 'linux'), true);
});
