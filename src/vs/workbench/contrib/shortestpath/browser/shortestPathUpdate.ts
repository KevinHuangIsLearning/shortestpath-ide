/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IShortestPathUpdate {
	readonly version: string;
	readonly downloadUrl: string;
	readonly minimumSupportedVersion?: string;
	readonly releaseNote?: string;
	readonly fastDownloadUrls?: IShortestPathFastDownloadUrls;
}

export interface IShortestPathUpdateDocument {
	readonly version?: unknown;
	readonly downloadUrl?: unknown;
	readonly minimumSupportedVersion?: unknown;
	readonly releaseNote?: unknown;
	readonly fastDownloadUrls?: unknown;
}

export interface IShortestPathFastDownloadUrls {
	readonly macosArm64?: string;
	readonly windowsUserSetup?: string;
	readonly windowsPortable?: string;
}

export interface IShortestPathUpdateTarget {
	readonly downloadUrl: string;
	readonly allowsMinimumVersionLock: boolean;
	readonly fastDownloadType?: keyof IShortestPathFastDownloadUrls;
}

export type ShortestPathUpdateDialogKind = 'none' | 'available' | 'required';

export function getShortestPathUpdateDialogKind(currentVersion: string, release: IShortestPathUpdate, target: IShortestPathUpdateTarget | undefined): ShortestPathUpdateDialogKind {
	if (!isShortestPathUpdateAvailable(currentVersion, release.version)) {
		return 'none';
	}
	if (release.minimumSupportedVersion && target?.allowsMinimumVersionLock !== false && !isShortestPathVersionSupported(currentVersion, release.minimumSupportedVersion)) {
		return 'required';
	}
	return 'available';
}

const SHORTEST_PATH_UPDATE_FALLBACK_URL = 'https://raw.gitcode.com/KevinHuangIsLearning/shortestpath-ide/raw/main/latest.json';

export function getShortestPathUpdateUrls(primaryUrl: string): readonly string[] {
	return primaryUrl === SHORTEST_PATH_UPDATE_FALLBACK_URL ? [primaryUrl] : [primaryUrl, SHORTEST_PATH_UPDATE_FALLBACK_URL];
}

export async function getShortestPathUpdateWithFallback<T>(primaryUrl: string, load: (url: string) => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (const url of getShortestPathUpdateUrls(primaryUrl)) {
		try {
			return await load(url);
		} catch (error) {
			lastError = error;
		}
	}
	throw lastError;
}

export interface IShortestPathUpdateGraceState {
	readonly version: string;
	readonly minimumSupportedVersion: string;
	readonly downloadUrl: string;
	readonly graceUntil: number;
}

export function parseShortestPathUpdateGraceState(value: unknown, version: string): IShortestPathUpdateGraceState | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}
	const state = value as Partial<IShortestPathUpdateGraceState>;
	if (state.version !== version || typeof state.minimumSupportedVersion !== 'string' || typeof state.downloadUrl !== 'string' || typeof state.graceUntil !== 'number' || !Number.isFinite(state.graceUntil)) {
		return undefined;
	}
	return {
		version: state.version,
		minimumSupportedVersion: state.minimumSupportedVersion,
		downloadUrl: state.downloadUrl,
		graceUntil: state.graceUntil,
	};
}

export function isShortestPathUpdateGraceStateForMinimumVersion(state: IShortestPathUpdateGraceState | undefined, minimumSupportedVersion: string | undefined): boolean {
	return state?.minimumSupportedVersion === minimumSupportedVersion;
}

export function getShortestPathUpdateGraceStateForMinimumVersion(value: unknown, version: string, minimumSupportedVersion: string | undefined, clear: () => void): IShortestPathUpdateGraceState | undefined {
	const state = parseShortestPathUpdateGraceState(value, version);
	if (!state) {
		if (value !== undefined) {
			clear();
		}
		return undefined;
	}
	if (!isShortestPathUpdateGraceStateForMinimumVersion(state, minimumSupportedVersion)) {
		clear();
		return undefined;
	}
	return state;
}

export function parseShortestPathWindowsInstallMode(value: string): 'user' | 'system' | undefined {
	const installMode = value.trim();
	return installMode === 'user' || installMode === 'system' ? installMode : undefined;
}

export function getShortestPathUpdateTarget(platform: string, installMode: 'user' | 'system' | undefined): IShortestPathUpdateTarget | undefined {
	const latestDownload = 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/';
	if (platform === 'darwin') {
		return { downloadUrl: `${latestDownload}ShortestPath-IDE-macos-arm64.zip`, allowsMinimumVersionLock: true, fastDownloadType: 'macosArm64' };
	}
	if (platform !== 'win32') {
		return undefined;
	}

	// Legacy system installations migrate to the remaining user installer.
	if (installMode === 'user' || installMode === 'system') {
		return { downloadUrl: `${latestDownload}ShortestPath-IDE-Windows-x64-User-Setup.exe`, allowsMinimumVersionLock: true, fastDownloadType: 'windowsUserSetup' };
	}
	return { downloadUrl: `${latestDownload}ShortestPath-IDE-Windows-x64.zip`, allowsMinimumVersionLock: false, fastDownloadType: 'windowsPortable' };
}

export function getShortestPathFastDownloadUrl(fastDownloadUrls: IShortestPathFastDownloadUrls | undefined, target: IShortestPathUpdateTarget | undefined): string | undefined {
	return target?.fastDownloadType ? fastDownloadUrls?.[target.fastDownloadType] : undefined;
}

export function parseShortestPathUpdateDocument(value: unknown): IShortestPathUpdate | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const document = value as IShortestPathUpdateDocument;
	if (typeof document.version !== 'string' || typeof document.downloadUrl !== 'string') {
		return undefined;
	}

	const minimumSupportedVersion = typeof document.minimumSupportedVersion === 'string'
		&& parseVersion(document.minimumSupportedVersion)
		&& parseVersion(document.version)
		&& !isShortestPathUpdateAvailable(document.version, document.minimumSupportedVersion)
		? document.minimumSupportedVersion : undefined;
	const fastDownloadUrls = parseShortestPathFastDownloadUrls(document.fastDownloadUrls);

	return {
		version: document.version,
		downloadUrl: document.downloadUrl,
		...(minimumSupportedVersion ? { minimumSupportedVersion } : {}),
		...(typeof document.releaseNote === 'string' ? { releaseNote: document.releaseNote } : {}),
		...(fastDownloadUrls ? { fastDownloadUrls } : {}),
	};
}

function parseShortestPathFastDownloadUrls(value: unknown): IShortestPathFastDownloadUrls | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const urls = value as Record<string, unknown>;
	return Object.fromEntries(Object.entries(urls).filter(([, url]) => typeof url === 'string'));
}

export function isShortestPathUpdateAvailable(currentVersion: string, availableVersion: string): boolean {
	const current = parseVersion(currentVersion);
	const available = parseVersion(availableVersion);
	if (!current || !available) {
		return false;
	}

	for (let index = 0; index < current.numbers.length; index++) {
		if (available.numbers[index] !== current.numbers[index]) {
			return available.numbers[index] > current.numbers[index];
		}
	}

	// Hotfixes follow the plain release; other suffixes are prereleases.
	const suffixRank = (suffix: string) => !suffix ? 0 : /^hotfix(?:[.-]|$)/i.test(suffix) ? 1 : -1;
	const currentRank = suffixRank(current.suffix);
	const availableRank = suffixRank(available.suffix);
	return availableRank !== currentRank ? availableRank > currentRank
		: available.suffix.localeCompare(current.suffix, 'en', { numeric: true, sensitivity: 'base' }) > 0;
}

export function isShortestPathVersionSupported(currentVersion: string, minimumSupportedVersion: string): boolean {
	return !isShortestPathUpdateAvailable(currentVersion, minimumSupportedVersion);
}

export function getShortestPathReleaseNotesUrl(version: string): string | undefined {
	return parseVersion(version) ? `https://raw.githubusercontent.com/KevinHuangIsLearning/shortestpath-ide/main/release-notes/${version}.md` : undefined;
}

function parseVersion(value: string): { numbers: readonly number[]; suffix: string } | undefined {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+[\w.-]+)?$/i.exec(value);
	if (!match) {
		return undefined;
	}
	const numbers = [Number(match[1]), Number(match[2]), Number(match[3])];
	return numbers.every(Number.isSafeInteger) ? { numbers, suffix: match[4] ?? '' } : undefined;
}
