/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { withCompilerRuntime } from '../compilerRuntime';

test('Windows compiler runtime merges case-insensitive PATH keys without losing inherited paths', () => {
	const environment = { Path: 'C:\\Windows;C:\\GCC Tools\\bin\\', PATH: 'C:\\Other', TEMP: 'C:\\Temp' };
	assert.deepEqual(withCompilerRuntime(environment, 'C:\\GCC Tools\\bin\\g++.exe', 'win32'), {
		Path: 'C:\\GCC Tools\\bin;C:\\Windows;C:\\Other', TEMP: 'C:\\Temp'
	});
	assert.equal(environment.Path, 'C:\\Windows;C:\\GCC Tools\\bin\\');
});

test('repeated initialization is idempotent and leaves non-Windows environments unchanged', () => {
	const first = withCompilerRuntime({}, 'D:\\portable\\bin\\g++.exe', 'win32');
	assert.deepEqual(withCompilerRuntime(first, 'D:\\portable\\bin\\g++.exe', 'win32'), first);
	assert.deepEqual(withCompilerRuntime({ PATH: '/usr/bin' }, '/opt/gcc/bin/g++', 'darwin'), { PATH: '/usr/bin' });
	assert.deepEqual(withCompilerRuntime({ Path: 'C:\\Windows' }, 'g++', 'win32'), { Path: 'C:\\Windows' });
});
