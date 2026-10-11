/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getShortestPathFastDownloadUrl, getShortestPathReleaseNotesUrl, getShortestPathUpdateDialogKind, getShortestPathUpdateGraceStateForMinimumVersion, getShortestPathUpdateTarget, getShortestPathUpdateUrls, getShortestPathUpdateWithFallback, isShortestPathUpdateAvailable, isShortestPathUpdateGraceStateForMinimumVersion, isShortestPathVersionSupported, parseShortestPathUpdateDocument, parseShortestPathUpdateGraceState, parseShortestPathWindowsInstallMode } from '../../../../contrib/shortestpath/browser/shortestPathUpdate.js';

suite('ShortestPath update check', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('requires only string version and download fields', () => {
		for (const version of ['0.2.1', 'v0.2.1', '0.2.1-hotfix', '0.2.1-beta', 'custom']) {
			for (const downloadUrl of ['https://example.com/release', 'http://example.com', 'custom download', '']) {
				assert.deepStrictEqual(parseShortestPathUpdateDocument({ version, downloadUrl }), { version, downloadUrl });
			}
		}
		for (const value of [null, [], 'manifest', {}, { version: 1, downloadUrl: 'url' }, { version: '0.2.1', downloadUrl: false }]) {
			assert.strictEqual(parseShortestPathUpdateDocument(value), undefined);
		}
	});

	test('accepts unrestricted string release notes and ignores other types', () => {
		const release = { version: '0.2.1', downloadUrl: 'url' };
		for (const releaseNote of ['', '   ', '修复若干问题。\n优化更新体验。', 'x'.repeat(10000)]) {
			assert.deepStrictEqual(parseShortestPathUpdateDocument({ ...release, releaseNote }), { ...release, releaseNote });
		}
		assert.deepStrictEqual(parseShortestPathUpdateDocument({ ...release, releaseNote: 123 }), release);
	});

	test('keeps string fast download fields and ignores invalid entries', () => {
		const release = { version: '0.2.1', downloadUrl: 'url' };
		const fastDownloadUrls = { macosArm64: 'not a URL', windowsUserSetup: '', customPlatform: 'custom link' };
		assert.deepStrictEqual(parseShortestPathUpdateDocument({ ...release, fastDownloadUrls: { ...fastDownloadUrls, windowsPortable: 123 } }), { ...release, fastDownloadUrls });
		for (const fastDownloadUrls of [null, [], 'link', 123]) {
			assert.deepStrictEqual(parseShortestPathUpdateDocument({ ...release, fastDownloadUrls }), release);
		}
	});

	test('retains only valid minimum supported versions no newer than the release', () => {
		const release = { version: '0.2.1-hotfix', downloadUrl: 'url' };
		for (const minimumSupportedVersion of ['0.2.0', '0.2.1', 'v0.2.1-hotfix']) {
			assert.deepStrictEqual(parseShortestPathUpdateDocument({ ...release, minimumSupportedVersion }), { ...release, minimumSupportedVersion });
		}
		for (const minimumSupportedVersion of ['newest', '0.2.2', '0.2.1-hotfix.2', 123]) {
			assert.deepStrictEqual(parseShortestPathUpdateDocument({ ...release, minimumSupportedVersion }), release);
		}
		assert.deepStrictEqual(parseShortestPathUpdateDocument({ ...release, version: 'custom', minimumSupportedVersion: '0.2.0' }), { version: 'custom', downloadUrl: 'url' });
	});

	test('compares semantic release versions', () => {
		assert.strictEqual(isShortestPathUpdateAvailable('0.2.0', '0.2.1'), true);
		assert.strictEqual(isShortestPathUpdateAvailable('0.2.1', '0.2.1'), false);
		assert.strictEqual(isShortestPathUpdateAvailable('0.3.0', '0.2.9'), false);
		assert.strictEqual(isShortestPathVersionSupported('0.2.0', '0.2.0'), true);
		assert.strictEqual(isShortestPathVersionSupported('0.1.9', '0.2.0'), false);
		for (const [current, available, expected] of [
			['0.4.8', 'v0.4.8', false],
			['0.4.8', '0.4.8-hotfix', true],
			['0.4.8-hotfix', '0.4.8', false],
			['0.4.8-hotfix.2', '0.4.8-hotfix.10', true],
			['0.4.8-beta.2', '0.4.8-beta.10', true],
			['0.4.8-beta', '0.4.8', true],
			['0.4.8', '0.4.8-beta', false],
			['0.4.8-hotfix', '0.4.9-beta', true],
			['0.4.8+build.1', '0.4.8+build.2', false],
			['invalid', '0.4.8', false],
		] as const) {
			assert.strictEqual(isShortestPathUpdateAvailable(current, available), expected, `${current} -> ${available}`);
		}
	});

	test('classifies update dialog behavior', () => {
		const release = { version: '0.3.16', downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.3.16', minimumSupportedVersion: '0.3.15' };
		assert.strictEqual(getShortestPathUpdateDialogKind('0.3.16', release, getShortestPathUpdateTarget('darwin', undefined)), 'none');
		assert.strictEqual(getShortestPathUpdateDialogKind('0.3.15', release, getShortestPathUpdateTarget('darwin', undefined)), 'available');
		assert.strictEqual(getShortestPathUpdateDialogKind('0.3.14', release, getShortestPathUpdateTarget('darwin', undefined)), 'required');
		assert.strictEqual(getShortestPathUpdateDialogKind('0.3.14', release, getShortestPathUpdateTarget('win32', undefined)), 'available');
	});

	test('gets release notes from the fixed GitHub Markdown directory', () => {
		assert.strictEqual(getShortestPathReleaseNotesUrl('0.3.0'), 'https://raw.githubusercontent.com/KevinHuangIsLearning/shortestpath-ide/main/release-notes/0.3.0.md');
		assert.strictEqual(getShortestPathReleaseNotesUrl('invalid'), undefined);
	});

	test('checks GitHub before the GitCode fallback', () => {
		const githubUrl = 'https://raw.githubusercontent.com/KevinHuangIsLearning/shortestpath-ide/main/latest.json';
		const gitcodeUrl = 'https://raw.gitcode.com/KevinHuangIsLearning/shortestpath-ide/raw/main/latest.json';
		assert.deepStrictEqual(getShortestPathUpdateUrls(githubUrl), [githubUrl, gitcodeUrl]);
		assert.deepStrictEqual(getShortestPathUpdateUrls(gitcodeUrl), [gitcodeUrl]);
	});

	test('uses GitCode after any GitHub failure', async () => {
		const githubUrl = 'https://raw.githubusercontent.com/KevinHuangIsLearning/shortestpath-ide/main/latest.json';
		const visited: string[] = [];
		const result = await getShortestPathUpdateWithFallback(githubUrl, async url => {
			visited.push(url);
			if (url === githubUrl) {
				throw new Error('invalid response');
			}
			return 'gitcode';
		});
		assert.strictEqual(result, 'gitcode');
		assert.deepStrictEqual(visited, [
			githubUrl,
			'https://raw.gitcode.com/KevinHuangIsLearning/shortestpath-ide/raw/main/latest.json',
		]);

		let attempts = 0;
		await assert.rejects(getShortestPathUpdateWithFallback(githubUrl, async url => {
			attempts++;
			throw new Error(url === githubUrl ? 'github failed' : 'gitcode failed');
		}), /gitcode failed/);
		assert.strictEqual(attempts, 2);
	});

	test('selects the matching direct download asset', () => {
		assert.deepStrictEqual(getShortestPathUpdateTarget('win32', 'user'), {
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-User-Setup.exe',
			allowsMinimumVersionLock: true,
			fastDownloadType: 'windowsUserSetup',
		});
		assert.deepStrictEqual(getShortestPathUpdateTarget('win32', 'system'), {
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-User-Setup.exe',
			allowsMinimumVersionLock: true,
			fastDownloadType: 'windowsUserSetup',
		});
		assert.deepStrictEqual(getShortestPathUpdateTarget('win32', undefined), {
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64.zip',
			allowsMinimumVersionLock: false,
			fastDownloadType: 'windowsPortable',
		});
		assert.deepStrictEqual(getShortestPathUpdateTarget('darwin', undefined), {
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip',
			allowsMinimumVersionLock: true,
			fastDownloadType: 'macosArm64',
		});
	});

	test('selects a fast download only for supported update targets', () => {
		const fastDownloadUrls = {
			macosArm64: 'https://www.icloud.com.cn/iclouddrive/macos',
			windowsUserSetup: 'https://www.icloud.com.cn/iclouddrive/user-setup',
			windowsPortable: 'https://www.icloud.com.cn/iclouddrive/portable',
		};
		assert.strictEqual(getShortestPathFastDownloadUrl(fastDownloadUrls, getShortestPathUpdateTarget('darwin', undefined)), fastDownloadUrls.macosArm64);
		assert.strictEqual(getShortestPathFastDownloadUrl(fastDownloadUrls, getShortestPathUpdateTarget('win32', 'user')), fastDownloadUrls.windowsUserSetup);
		assert.strictEqual(getShortestPathFastDownloadUrl(fastDownloadUrls, getShortestPathUpdateTarget('win32', undefined)), fastDownloadUrls.windowsPortable);
		assert.strictEqual(getShortestPathFastDownloadUrl(fastDownloadUrls, getShortestPathUpdateTarget('win32', 'system')), fastDownloadUrls.windowsUserSetup);
	});

	test('accepts only installer modes written by supported installers', () => {
		assert.strictEqual(parseShortestPathWindowsInstallMode('user\n'), 'user');
		assert.strictEqual(parseShortestPathWindowsInstallMode(' system '), 'system');
		assert.strictEqual(parseShortestPathWindowsInstallMode('portable'), undefined);
		assert.strictEqual(parseShortestPathWindowsInstallMode(''), undefined);
	});

	test('accepts only valid persisted network grace states', () => {
		const grace = {
			version: '0.2.0',
			minimumSupportedVersion: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip',
			graceUntil: 123,
		};
		assert.deepStrictEqual(parseShortestPathUpdateGraceState(grace, '0.2.0'), grace);
		assert.strictEqual(parseShortestPathUpdateGraceState({ ...grace, graceUntil: Number.NaN }, '0.2.0'), undefined);
		assert.deepStrictEqual(parseShortestPathUpdateGraceState({ ...grace, downloadUrl: 'custom download' }, '0.2.0'), { ...grace, downloadUrl: 'custom download' });
		assert.strictEqual(parseShortestPathUpdateGraceState({ ...grace, graceUntil: undefined, permanentlyAllowed: true }, '0.2.0'), undefined);
		assert.deepStrictEqual(parseShortestPathUpdateGraceState({ ...grace, graceCount: 1 }, '0.2.0'), grace);
	});

	test('binds persisted grace state to its minimum supported version', () => {
		const grace = parseShortestPathUpdateGraceState({
			version: '0.2.0',
			minimumSupportedVersion: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip',
			graceUntil: 123,
		}, '0.2.0');

		assert.strictEqual(isShortestPathUpdateGraceStateForMinimumVersion(grace, '0.2.1'), true);
		assert.strictEqual(isShortestPathUpdateGraceStateForMinimumVersion(grace, '0.2.2'), false);
		assert.strictEqual(isShortestPathUpdateGraceStateForMinimumVersion(grace, undefined), false);
	});

	test('clears mismatched and legacy permanent grace', () => {
		for (const state of [
			{ version: '0.2.0', minimumSupportedVersion: '0.2.2', downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip', graceUntil: 123 },
			{ version: '0.2.0', minimumSupportedVersion: '0.2.2', downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip', graceCount: 2, permanentlyAllowed: true },
		]) {
			let stored: unknown = state;
			assert.strictEqual(getShortestPathUpdateGraceStateForMinimumVersion(stored, '0.2.0', '0.2.1', () => stored = undefined), undefined);
			assert.strictEqual(stored, undefined);

			stored = state;
			assert.strictEqual(getShortestPathUpdateGraceStateForMinimumVersion(stored, '0.2.0', undefined, () => stored = undefined), undefined);
			assert.strictEqual(stored, undefined);
		}
	});

});
