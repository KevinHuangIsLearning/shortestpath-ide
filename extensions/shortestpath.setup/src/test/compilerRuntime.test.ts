/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCompilerPathFlags, withCompilerPathFlags, withCompilerRuntime } from '../compilerRuntime';

const aliasedCompiler = 'C:\\.shortestpath-toolchain-0123456789ab\\User\\globalStorage\\shortestpath.shortestpath-setup\\toolchains\\winlibs\\mingw64-ucrt-15\\bin\\g++.exe';

test('managed GCC junctions retain their prefix, including named profiles and forward slashes', () => {
	assert.deepEqual([
		getCompilerPathFlags(aliasedCompiler),
		getCompilerPathFlags(aliasedCompiler.replaceAll('\\', '/')),
		getCompilerPathFlags(aliasedCompiler.replace('\\User\\', '\\User\\profiles\\abc\\')),
		getCompilerPathFlags('C:\\Custom\\bin\\g++.exe'),
		getCompilerPathFlags('/usr/bin/g++')
	], [['-no-canonical-prefixes'], ['-no-canonical-prefixes'], ['-no-canonical-prefixes'], [], []]);
});

test('compiler path flags preserve custom options and are idempotent', () => {
	const flags = '-std=c++23 -O0 -DLOCAL -I"C:\\My Headers"';
	const updated = `${flags} -no-canonical-prefixes`;
	assert.deepEqual([
		withCompilerPathFlags(flags, aliasedCompiler),
		withCompilerPathFlags(updated, aliasedCompiler),
		withCompilerPathFlags(`${flags} "-no-canonical-prefixes"`, aliasedCompiler),
		withCompilerPathFlags('', aliasedCompiler),
		withCompilerPathFlags(flags, 'C:\\Custom\\bin\\g++.exe')
	], [updated, updated, `${flags} "-no-canonical-prefixes"`, '-no-canonical-prefixes', flags]);
});

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
