/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path = require("path");
import { lookpath } from "lookpath";

/** Environment overrides shared by compilation and program launch. */
export async function getCompilerEnvironment(compiler: string): Promise<Record<string, string>> {
	if (process.platform !== "win32") { return {}; }
	const resolved = path.win32.isAbsolute(compiler) ? compiler : await lookpath(compiler);
	return resolved ? compilerRuntimePath(resolved, process.env) : {};
}

/** Put the selected compiler's DLL directory before other toolchains, without changing global PATH. */
export function compilerRuntimePath(compiler: string, env: NodeJS.ProcessEnv): Record<string, string> {
	const directory = path.win32.dirname(compiler);
	const normalize = (value: string) => path.win32.normalize(value.replace(/^"|"$/g, "")).replace(/\\+$/, "").toLowerCase();
	const keys = Object.keys(env).filter(key => key.toLowerCase() === "path");
	const entries = keys.flatMap(key => (env[key] ?? "").split(";")).filter(Boolean);
	// Use a single canonical key: Windows treats PATH/Path case-insensitively,
	// whereas Node's environment objects can contain both spellings.
	return { PATH: [directory, ...entries.filter(entry => normalize(entry) !== normalize(directory))].join(";") };
}
