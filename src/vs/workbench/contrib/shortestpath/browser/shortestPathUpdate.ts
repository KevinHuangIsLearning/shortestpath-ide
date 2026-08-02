/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IShortestPathRelease {
	readonly tag_name: string;
	readonly html_url: string;
	readonly draft: boolean;
	readonly prerelease: boolean;
}

export interface IShortestPathUpdate {
	readonly version: string;
	readonly downloadUrl: string;
}

export const SHORTESTPATH_UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

export function getShortestPathUpdateCheckDelay(lastChecked: number, now: number): number {
	if (!Number.isFinite(lastChecked) || lastChecked <= 0) {
		return 10000;
	}

	return Math.max(10000, lastChecked + SHORTESTPATH_UPDATE_CHECK_INTERVAL - now);
}

export function parseShortestPathRelease(release: IShortestPathRelease): IShortestPathUpdate | undefined {
	if (release.draft || release.prerelease || typeof release.html_url !== 'string') {
		return undefined;
	}

	const match = /^Release-v(\d+)\.(\d+)\.(\d+)$/.exec(release.tag_name);
	if (!match) {
		return undefined;
	}

	return {
		version: `${match[1]}.${match[2]}.${match[3]}`,
		downloadUrl: release.html_url,
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

function parseVersion(value: string): readonly number[] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
	if (!match) {
		return undefined;
	}

	return [Number(match[1]), Number(match[2]), Number(match[3])];
}
