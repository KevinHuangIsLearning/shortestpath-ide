/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import * as path from 'node:path';

export type CodeFolderLocation = { path: string; portableDataPath?: string };

/** Remember relative positions only for directories on the portable installation's volume. */
export function codeFolderLocation(folder: string, portableDataPath?: string): CodeFolderLocation {
	const location: CodeFolderLocation = { path: folder };
	if (portableDataPath && path.isAbsolute(portableDataPath) && path.isAbsolute(folder)) {
		try {
			if (path.parse(folder).root.toLowerCase() === path.parse(portableDataPath).root.toLowerCase()
				&& fs.statSync(folder).dev === fs.statSync(portableDataPath).dev) {
				location.portableDataPath = portableDataPath;
			}
		} catch { /* Keep the absolute path when the portable volume cannot be identified. */ }
	}
	return location;
}

/** Try the moved portable directory before the original absolute path. */
export function codeFolderCandidates(value: unknown, portableDataPath?: string, paths: path.PlatformPath = path): string[] {
	if (!value || typeof value !== 'object') { return []; }
	const location = value as Partial<CodeFolderLocation>;
	if (typeof location.path !== 'string' || !paths.isAbsolute(location.path)) { return []; }
	const candidates = [location.path];
	if (portableDataPath && paths.isAbsolute(portableDataPath) && typeof location.portableDataPath === 'string' && paths.isAbsolute(location.portableDataPath)) {
		const relative = paths.relative(location.portableDataPath, location.path);
		if (!paths.isAbsolute(relative)) { candidates.unshift(paths.resolve(portableDataPath, relative)); }
	}
	return [...new Set(candidates)];
}

/** Ignore unavailable folders without deleting their remembered location. */
export function existingCodeFolder(candidates: readonly string[]): string | undefined {
	return candidates.find(folder => {
		try { return fs.statSync(folder).isDirectory(); } catch { return false; }
	});
}
