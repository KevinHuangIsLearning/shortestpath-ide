/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Settings that are registered on Windows and macOS only. Writing them on
// Linux fails with "not a registered configuration".
export const linuxUnsupportedSettings: readonly string[] = [
	// Native UI colors always follow the system color scheme on Linux.
	'window.systemColorTheme',
];

export function isSettingSupportedOnPlatform(key: string, platform: NodeJS.Platform = process.platform): boolean {
	return platform !== 'linux' || !linuxUnsupportedSettings.includes(key);
}

export function withPlatformSettings(settings: Record<string, unknown>, platform: NodeJS.Platform = process.platform): Record<string, unknown> {
	const result = { ...settings };
	for (const key of linuxUnsupportedSettings) {
		if (!isSettingSupportedOnPlatform(key, platform)) {
			delete result[key];
		}
	}
	return result;
}
