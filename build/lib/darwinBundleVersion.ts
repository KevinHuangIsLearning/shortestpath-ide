/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Update only the application bundle; preserve Electron framework and helper versions. */
export function updateDarwinBundleVersion(relativePath: string, contents: Buffer, appName: string, version: string): Buffer {
	if (relativePath.replace(/\\/g, '/') !== `${appName}.app/Contents/Info.plist`) {
		return contents;
	}
	if (!/^\d+\.\d+\.\d+$/.test(version)) {
		throw new Error(`Invalid macOS product version: ${version}`);
	}
	let plist = contents.toString('utf8');
	for (const key of ['CFBundleShortVersionString', 'CFBundleVersion']) {
		const field = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
		if (!field.test(plist)) {
			throw new Error(`Missing ${key} in application Info.plist`);
		}
		plist = plist.replace(field, (_match, before: string, after: string) => `${before}${version}${after}`);
	}
	return Buffer.from(plist);
}
