/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import { managedClangdConfigMarker, rebaseGeneratedClangdConfig, rebaseManagedQueryDriver, rebaseManagedToolchainPath } from '../portableToolchain';

suite('Portable ShortestPath toolchain paths', () => {
	const compiler = 'F:\\ShortestPath\\data\\user-data\\User\\globalStorage\\shortestpath.shortestpath-setup\\toolchains\\winlibs\\mingw64\\bin\\g++.exe';
	const clangd = 'F:\\ShortestPath\\data\\user-data\\User\\globalStorage\\shortestpath.shortestpath-setup\\toolchains\\clangd\\clangd_22.1.6\\bin\\clangd.exe';

	test('rebases managed compiler and clangd paths after a drive-letter change', () => {
		assert.deepStrictEqual([
			rebaseManagedToolchainPath('E:\\Old\\User\\globalStorage\\shortestpath.shortestpath-setup\\toolchains\\winlibs\\mingw64\\bin\\g++.exe', compiler, clangd),
			rebaseManagedToolchainPath('E:\\Old\\User\\globalStorage\\shortestpath.shortestpath-setup\\toolchains\\clangd\\clangd_22.1.6\\bin\\clangd.exe', compiler, clangd),
			rebaseManagedToolchainPath('C:\\MySDK\\toolchains\\winlibs\\mingw64\\bin\\g++.exe', compiler, clangd)
		], [compiler, clangd, undefined]);
	});

	test('rebases only managed query-driver arguments', () => {
		assert.deepStrictEqual([
			rebaseManagedQueryDriver('--background-index', compiler),
			rebaseManagedQueryDriver('--query-driver=C:/Custom/g++.exe, E:/Old/User/globalStorage/shortestpath.shortestpath-setup/toolchains/winlibs/mingw64/bin/g++.exe', compiler),
			rebaseManagedQueryDriver('--query-driver=C:/MySDK/toolchains/winlibs/mingw64/bin/g++.exe', compiler)
		], [
			'--background-index',
			`--query-driver=C:/Custom/g++.exe, ${compiler}`,
			'--query-driver=C:/MySDK/toolchains/winlibs/mingw64/bin/g++.exe'
		]);
	});

	test('rewrites only ShortestPath-generated clangd configuration', () => {
		const oldCompiler = 'E:/Old/User/globalStorage/shortestpath.shortestpath-setup/toolchains/winlibs/mingw64/bin/g++.exe';
		const generated = `CompileFlags:\n  Add:\n    - -std=c++23\n    - -Wall\n    - -Wextra\n    - "-Drsize_t=size_t"\n    - "-D__STDC_WANT_LIB_EXT1__=1"\n    - "-D__float128=long double"\n    - -U__SIZEOF_FLOAT128__\n  BuiltinHeaders: QueryDriver\n  Compiler: "${oldCompiler}"\n\nCompletion:\n  HeaderInsertion: Never\n\nIndex:\n  Background: Build\n`;
		const custom = `${generated}Diagnostics:\n  UnusedIncludes: Strict\n`;
		const marked = `${managedClangdConfigMarker}\r\n${custom}`;
		assert.deepStrictEqual([
			rebaseGeneratedClangdConfig(generated, compiler),
			rebaseGeneratedClangdConfig(custom, compiler),
			rebaseGeneratedClangdConfig(marked, compiler)
		], [
			generated.replace(oldCompiler, compiler.replaceAll('\\', '/')),
			custom,
			marked.replace(oldCompiler, compiler.replaceAll('\\', '/'))
		]);
	});
});
