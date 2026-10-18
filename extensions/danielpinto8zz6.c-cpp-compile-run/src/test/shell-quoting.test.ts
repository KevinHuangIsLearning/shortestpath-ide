/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import { spawnSync } from "child_process";
import { quoteCmdArgument, quotePowerShellArgument } from "../utils/shell-quoting";

suite("Shell argument round trips", () => {
	const values = [
		"[SPOJ] \u4e2d\u6587\u9898\u76ee.cpp",
		"[SPOJ] \u2018\u4e2d\u6587\u2019.cpp",
		"[SPOJ] Alice's \u9898\u76ee.exe",
		"C:\\My Tools\\\u4e2d\u6587 & (test)\\compiler.exe",
		"%SHORTESTPATH_QUOTING_TEST%%SHORTESTPATH_QUOTING_TEST%",
		"caret^ and %SHORTESTPATH_QUOTING_TEST% and $value `backtick",
		"-fsanitize=address,undefined"
	];
	const args = ["-p", "JSON.stringify(process.argv.slice(1))", "--", ...values];
	const options = {
		encoding: "utf8" as const,
		timeout: 10_000,
		windowsHide: true,
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SHORTESTPATH_QUOTING_TEST: "must not expand" }
	};

	(process.platform === "win32" ? test : test.skip)("PowerShell preserves filenames and compiler flags literally", () => {
		const command = `& ${[process.execPath, ...args].map(quotePowerShellArgument).join(" ")}; exit $LASTEXITCODE`;
		const child = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], options);
		assert.ifError(child.error);
		assert.strictEqual(child.status, 0, child.stderr);
		assert.deepStrictEqual(JSON.parse(child.stdout), values);
	});

	(process.platform === "win32" ? test : test.skip)("CMD preserves percent signs and shell metacharacters in filenames", () => {
		const command = [process.execPath, ...args].map(quoteCmdArgument).join(" ");
		const child = spawnSync(command, [], { ...options, shell: process.env.ComSpec });
		assert.ifError(child.error);
		assert.strictEqual(child.status, 0, child.stderr);
		assert.deepStrictEqual(JSON.parse(child.stdout), values);
	});
});
