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

export interface IShortestPathUpdateTarget {
	readonly downloadUrl: string;
	readonly allowsMinimumVersionLock: boolean;
}

export interface IShortestPathUpdateGraceState {
	readonly version: string;
	readonly minimumSupportedVersion: string;
	readonly downloadUrl: string;
	readonly graceCount: number;
	readonly graceUntil?: number;
	readonly permanentlyAllowed?: boolean;
}

export function parseShortestPathUpdateGraceState(value: unknown, version: string): IShortestPathUpdateGraceState | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const state = value as Partial<IShortestPathUpdateGraceState>;
	const graceCount = state.graceCount;
	if (state.version !== version || typeof state.minimumSupportedVersion !== 'string' || typeof state.downloadUrl !== 'string' || typeof graceCount !== 'number' || !Number.isInteger(graceCount) || graceCount < 0 || graceCount > 2 || (state.permanentlyAllowed !== undefined && typeof state.permanentlyAllowed !== 'boolean')) {
		return undefined;
	}
	try {
		const url = new URL(state.downloadUrl);
		if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith('/KevinHuangIsLearning/shortestpath-ide/releases/')) {
			return undefined;
		}
	} catch {
		return undefined;
	}
	if (state.permanentlyAllowed === true) {
		return graceCount === 2 && state.graceUntil === undefined ? state as IShortestPathUpdateGraceState : undefined;
	}
	return graceCount >= 1 && typeof state.graceUntil === 'number' && Number.isFinite(state.graceUntil) ? state as IShortestPathUpdateGraceState : undefined;
}

export function parseShortestPathWindowsInstallMode(value: string): 'user' | 'system' | undefined {
	const installMode = value.trim();
	return installMode === 'user' || installMode === 'system' ? installMode : undefined;
}

export function getShortestPathUpdateTarget(platform: string, installMode: 'user' | 'system' | undefined): IShortestPathUpdateTarget | undefined {
	const latestDownload = 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/';
	if (platform === 'darwin') {
		return { downloadUrl: `${latestDownload}ShortestPath-IDE-macos-arm64.zip`, allowsMinimumVersionLock: true };
	}
	if (platform !== 'win32') {
		return undefined;
	}

	if (installMode === 'user') {
		return { downloadUrl: `${latestDownload}ShortestPath-IDE-Windows-Exclude-Compiler-x64-User-Setup.exe`, allowsMinimumVersionLock: true };
	}
	if (installMode === 'system') {
		return { downloadUrl: `${latestDownload}ShortestPath-IDE-Windows-Exclude-Compiler-x64-Setup.exe`, allowsMinimumVersionLock: true };
	}
	return { downloadUrl: `${latestDownload}ShortestPath-IDE-Windows-Exclude-Compiler-x64.zip`, allowsMinimumVersionLock: false };
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

export function getShortestPathReleaseNotesUrl(version: string): string | undefined {
	return parseVersion(version) ? `https://raw.githubusercontent.com/KevinHuangIsLearning/shortestpath-ide/main/release-notes/${version}.md` : undefined;
}

function parseVersion(value: string): readonly number[] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
	if (!match) {
		return undefined;
	}

	return [Number(match[1]), Number(match[2]), Number(match[3])];
}
