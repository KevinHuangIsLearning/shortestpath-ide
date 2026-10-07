/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

/** Initialize problem files, replacing existing source only after explicit save-dialog confirmation. */
export function initializeProblemSourceFile(sourcePath: string, template: string | null, replaceExisting = false): boolean {
	if (!replaceExisting && existsSync(sourcePath)) { return false; }
	mkdirSync(path.dirname(sourcePath), { recursive: true });
	try {
		writeFileSync(sourcePath, template ?? '', { flag: replaceExisting ? 'w' : 'wx' });
		return true;
	} catch (error) {
		if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST') { return false; }
		throw error;
	}
}
