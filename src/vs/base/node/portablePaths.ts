/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Whether portable mode may safely replace the process temporary directory. */
export function shouldUsePortableTemp(platform: NodeJS.Platform, portableTempPath: string): boolean {
	return platform !== 'win32' || !/\s/.test(portableTempPath);
}
