/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';

/** MinGW executables find their shared runtime DLLs through the child PATH. */
export function withCompilerRuntime(environment: NodeJS.ProcessEnv, compiler: string, platform: NodeJS.Platform = process.platform): NodeJS.ProcessEnv {
	const result = { ...environment };
	if (platform !== 'win32' || !path.win32.isAbsolute(compiler)) { return result; }
	const directory = path.win32.dirname(compiler);
	const keys = Object.keys(result).filter(key => key.toLowerCase() === 'path');
	const key = keys[0] ?? 'PATH';
	const entries = keys.flatMap(name => (result[name] ?? '').split(';')).filter(Boolean);
	const normalize = (value: string) => path.win32.normalize(value.replace(/^"|"$/g, '')).replace(/[\\/]+$/, '').toLowerCase();
	const filtered = entries.filter(value => normalize(value) !== normalize(directory));
	for (const name of keys) { delete result[name]; }
	result[key] = [directory, ...filtered].join(';');
	return result;
}
