/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { getShortestPathReleaseNotesUrl, getShortestPathUpdateGraceStateForMinimumVersion, getShortestPathUpdateTarget, isShortestPathUpdateAvailable, isShortestPathUpdateGraceStateForMinimumVersion, isShortestPathVersionSupported, parseShortestPathUpdateDocument, parseShortestPathUpdateGraceState, parseShortestPathWindowsInstallMode } from '../../../../contrib/shortestpath/browser/shortestPathUpdate.js';

suite('ShortestPath update check', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parses a valid latest update document only', () => {
		assert.deepStrictEqual(parseShortestPathUpdateDocument({
			version: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1',
		}), {
			version: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1',
		});
		assert.strictEqual(parseShortestPathUpdateDocument({ version: '0.2.1', downloadUrl: 'https://example.com/release' }), undefined);
		assert.strictEqual(parseShortestPathUpdateDocument({ version: '0.2.1', downloadUrl: 'https://github.com/example/other/releases/tag/Release-v0.2.1' }), undefined);
		assert.strictEqual(parseShortestPathUpdateDocument({ version: '0.2.2', downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1' }), undefined);
	});

	test('parses a minimum supported version', () => {
		assert.deepStrictEqual(parseShortestPathUpdateDocument({
			version: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1',
			minimumSupportedVersion: '0.2.0',
		}), {
			version: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1',
			minimumSupportedVersion: '0.2.0',
		});
		assert.strictEqual(parseShortestPathUpdateDocument({
			version: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1',
			minimumSupportedVersion: 'newest',
		}), undefined);
		assert.strictEqual(parseShortestPathUpdateDocument({
			version: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/tag/Release-v0.2.1',
			minimumSupportedVersion: '0.2.2',
		}), undefined);
	});

	test('compares semantic release versions', () => {
		assert.strictEqual(isShortestPathUpdateAvailable('0.2.0', '0.2.1'), true);
		assert.strictEqual(isShortestPathUpdateAvailable('0.2.1', '0.2.1'), false);
		assert.strictEqual(isShortestPathUpdateAvailable('0.3.0', '0.2.9'), false);
		assert.strictEqual(isShortestPathVersionSupported('0.2.0', '0.2.0'), true);
		assert.strictEqual(isShortestPathVersionSupported('0.1.9', '0.2.0'), false);
	});

	test('gets release notes from the fixed GitHub Markdown directory', () => {
		assert.strictEqual(getShortestPathReleaseNotesUrl('0.3.0'), 'https://raw.githubusercontent.com/KevinHuangIsLearning/shortestpath-ide/main/release-notes/0.3.0.md');
		assert.strictEqual(getShortestPathReleaseNotesUrl('invalid'), undefined);
	});

	test('selects the matching direct download asset', () => {
		assert.deepStrictEqual(getShortestPathUpdateTarget('win32', 'user'), {
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64-User-Setup.exe',
			allowsMinimumVersionLock: true,
		});
		assert.deepStrictEqual(getShortestPathUpdateTarget('win32', 'system'), {
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64-Setup.exe',
			allowsMinimumVersionLock: true,
		});
		assert.deepStrictEqual(getShortestPathUpdateTarget('win32', undefined), {
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64.zip',
			allowsMinimumVersionLock: false,
		});
		assert.deepStrictEqual(getShortestPathUpdateTarget('darwin', undefined), {
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip',
			allowsMinimumVersionLock: true,
		});
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
			graceCount: 1,
			graceUntil: 123,
		};
		assert.deepStrictEqual(parseShortestPathUpdateGraceState(grace, '0.2.0'), grace);
		assert.strictEqual(parseShortestPathUpdateGraceState({ ...grace, graceCount: 0 }, '0.2.0'), undefined);
		assert.strictEqual(parseShortestPathUpdateGraceState({ ...grace, graceCount: 3 }, '0.2.0'), undefined);
		assert.strictEqual(parseShortestPathUpdateGraceState({ ...grace, graceUntil: Number.NaN }, '0.2.0'), undefined);
		assert.strictEqual(parseShortestPathUpdateGraceState({ ...grace, downloadUrl: 'https://example.com/update' }, '0.2.0'), undefined);
		assert.deepStrictEqual(parseShortestPathUpdateGraceState({ ...grace, graceCount: 2, graceUntil: undefined, permanentlyAllowed: true }, '0.2.0'), { ...grace, graceCount: 2, graceUntil: undefined, permanentlyAllowed: true });
		assert.strictEqual(parseShortestPathUpdateGraceState({ ...grace, graceCount: 1, graceUntil: undefined, permanentlyAllowed: true }, '0.2.0'), undefined);
		assert.strictEqual(parseShortestPathUpdateGraceState({ ...grace, permanentlyAllowed: true }, '0.2.0'), undefined);
	});

	test('binds persisted grace state to its minimum supported version', () => {
		const grace = parseShortestPathUpdateGraceState({
			version: '0.2.0',
			minimumSupportedVersion: '0.2.1',
			downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip',
			graceCount: 2,
			permanentlyAllowed: true,
		}, '0.2.0');

		assert.strictEqual(isShortestPathUpdateGraceStateForMinimumVersion(grace, '0.2.1'), true);
		assert.strictEqual(isShortestPathUpdateGraceStateForMinimumVersion(grace, '0.2.2'), false);
		assert.strictEqual(isShortestPathUpdateGraceStateForMinimumVersion(grace, undefined), false);
	});

	test('clears temporary and permanent grace when the minimum version changes', () => {
		for (const state of [
			{ version: '0.2.0', minimumSupportedVersion: '0.2.2', downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip', graceCount: 1, graceUntil: 123 },
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
