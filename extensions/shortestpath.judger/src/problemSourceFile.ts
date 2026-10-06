/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

/** Initialize new problem files once, preserving any existing user source. */
export function initializeProblemSourceFile(sourcePath: string, template: string | null): boolean {
	if (existsSync(sourcePath)) { return false; }
	mkdirSync(path.dirname(sourcePath), { recursive: true });
	try {
		writeFileSync(sourcePath, template ?? '', { flag: 'wx' });
		return true;
	} catch (error) {
		if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'EEXIST') { return false; }
		throw error;
	}
}
