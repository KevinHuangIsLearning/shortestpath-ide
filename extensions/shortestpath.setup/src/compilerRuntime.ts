/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';

/** GCC must retain the junction prefix when locating its headers and tools. */
export function getCompilerPathFlags(compiler: string): string[] {
	return /^[a-z]:\/\.shortestpath-toolchain-[a-f0-9]{12}\/User\/(?:profiles\/[^/]+\/)?globalStorage\/shortestpath\.shortestpath-setup\/toolchains\/winlibs\/mingw64-ucrt-15\/bin\/g\+\+\.exe$/i.test(compiler.replaceAll('\\', '/'))
		? ['-no-canonical-prefixes'] : [];
}

/** Preserve custom compiler options and add the path option only once. */
export function withCompilerPathFlags(flags: string, compiler: string): string {
	const additions = getCompilerPathFlags(compiler).filter(flag => !flags.split(/\s+/).some(value => value.replace(/^["']|["']$/g, '') === flag));
	return additions.length ? `${flags}${flags && !/\s$/.test(flags) ? ' ' : ''}${additions.join(' ')}` : flags;
}

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
