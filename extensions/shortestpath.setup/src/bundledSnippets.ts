/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

/** Seed a new profile without replacing snippets created or edited by the user. */
export async function installBundledCppSnippets(snippetsFile: string, extensionPath: string): Promise<void> {
	try {
		await fs.stat(snippetsFile);
		return;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { throw error; }
	}
	const source = await fs.readFile(path.join(extensionPath, 'resources', 'cpp.code-snippets'));
	await fs.mkdir(path.dirname(snippetsFile), { recursive: true });
	try {
		await fs.writeFile(snippetsFile, source, { flag: 'wx' });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') { throw error; }
	}
}
