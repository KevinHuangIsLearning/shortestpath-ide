/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function isShortestPathElectronLocale(relativePath: string, platform: string): boolean {
	const normalizedPath = relativePath.replace(/\\/g, '/');
	if (platform === 'darwin') {
		const match = /(?:^|\/)Electron Framework\.framework\/Versions\/A\/Resources\/([^/]+)\.lproj(?:\/|$)/.exec(normalizedPath);
		return !match || match[1] === 'en' || match[1] === 'zh_CN';
	}
	if (platform === 'win32') {
		const match = /(?:^|\/)locales\/([^/]+)\.pak$/.exec(normalizedPath);
		return !match || match[1] === 'en-US' || match[1] === 'zh-CN';
	}
	return true;
}
