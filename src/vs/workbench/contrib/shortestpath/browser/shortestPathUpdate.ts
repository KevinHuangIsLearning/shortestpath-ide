/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IShortestPathUpdate {
	readonly version: string;
	readonly downloadUrl: string;
	readonly minimumSupportedVersion?: string;
}

export interface IShortestPathUpdateDocument {
	readonly version?: unknown;
	readonly downloadUrl?: unknown;
	readonly minimumSupportedVersion?: unknown;
}

export function parseShortestPathUpdateDocument(document: IShortestPathUpdateDocument): IShortestPathUpdate | undefined {
	if (typeof document.version !== 'string' || typeof document.downloadUrl !== 'string' || !parseVersion(document.version)) {
		return undefined;
	}

	let downloadUrl: URL;
	try {
		downloadUrl = new URL(document.downloadUrl);
	} catch {
		return undefined;
	}
	const expectedPath = `/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v${document.version}`;
	if (downloadUrl.protocol !== 'https:' || downloadUrl.hostname !== 'github.com' || downloadUrl.pathname !== expectedPath) {
		return undefined;
	}

	const minimumSupportedVersion = document.minimumSupportedVersion;
	if (minimumSupportedVersion !== undefined && (typeof minimumSupportedVersion !== 'string' || !parseVersion(minimumSupportedVersion))) {
		return undefined;
	}
	if (minimumSupportedVersion && isShortestPathUpdateAvailable(document.version, minimumSupportedVersion)) {
		return undefined;
	}

	return {
		version: document.version,
		downloadUrl: downloadUrl.toString(),
		...(minimumSupportedVersion ? { minimumSupportedVersion } : {}),
	};
}

export function isShortestPathUpdateAvailable(currentVersion: string, availableVersion: string): boolean {
	const current = parseVersion(currentVersion);
	const available = parseVersion(availableVersion);
	if (!current || !available) {
		return false;
	}

	for (let index = 0; index < current.length; index++) {
		if (available[index] !== current[index]) {
			return available[index] > current[index];
		}
	}

	return false;
}

export function isShortestPathVersionSupported(currentVersion: string, minimumSupportedVersion: string): boolean {
	return !isShortestPathUpdateAvailable(currentVersion, minimumSupportedVersion);
}

function parseVersion(value: string): readonly number[] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
	if (!match) {
		return undefined;
	}

	return [Number(match[1]), Number(match[2]), Number(match[3])];
}
