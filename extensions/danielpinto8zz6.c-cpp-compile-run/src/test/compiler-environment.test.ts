/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import { compilerRuntimePath } from "../utils/compiler-environment";

suite("Compiler runtime environment", () => {
	test("selected MinGW takes precedence over stale toolchains and mixed-case PATH entries", () => {
		const env = {
			Path: 'C:\\old-mingw\\bin;"c:/tools/mingw/bin/";C:\\Windows\\System32',
			PATH: "C:\\other-tools",
			LANG: "zh_CN.GBK",
			LC_ALL: "C"
		};
		const original = { ...env };
		assert.deepStrictEqual(compilerRuntimePath("C:\\tools\\mingw\\bin\\g++.exe", env), {
			PATH: "C:\\tools\\mingw\\bin;C:\\old-mingw\\bin;C:\\Windows\\System32;C:\\other-tools"
		});
		assert.deepStrictEqual(env, original);
	});
});
