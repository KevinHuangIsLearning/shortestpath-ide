/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
