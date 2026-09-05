/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { createWriteStream, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { finished } from 'node:stream/promises';
import { test } from 'node:test';
import * as yazl from 'yazl';
import { installPortableAssets } from '../portableToolchainInstaller';

const windowsInstaller = require('../../resources/windows.js') as {
	getPortableAssets(input: { source?: { id: string } }): readonly { readonly id: string; readonly directoryToRemove?: string }[];
};

test('Windows compiler asset removes GCC locale catalogs after preparation', () => {
	const compiler = windowsInstaller.getPortableAssets({}).find(asset => asset.id === 'MinGW Lite GCC 15.2.0');
	assert.equal(compiler?.directoryToRemove, 'mingw64-ucrt-15/share/locale');
});

test('reports a missing download source without creating a fake toolchain', async () => {
	const toolchainRoot = await mkdtemp(path.join(os.tmpdir(), 'shortestpath-toolchain-test-'));
	try {
		const result = await installPortableAssets({
			appRoot: toolchainRoot,
			toolchainRoot,
			assets: [{
				id: 'test compiler',
				urls: [],
				archiveName: 'compiler.zip',
				targetDirectory: 'compiler',
				requiredFile: 'bin/compiler'
			}],
			reportProgress: () => undefined
		});
		assert.deepStrictEqual(result, {
			success: false,
			message: 'No download source is configured for test compiler.'
		});
	} finally {
		await rm(toolchainRoot, { recursive: true, force: true });
	}
});

test('removes compiler locale data when an existing portable toolchain is prepared', async () => {
	const toolchainRoot = await mkdtemp(path.join(os.tmpdir(), 'shortestpath-toolchain-test-'));
	const compilerRoot = path.join(toolchainRoot, 'winlibs', 'mingw64-ucrt-15');
	const localeRoot = path.join(compilerRoot, 'share', 'locale');
	try {
		await mkdir(path.join(compilerRoot, 'bin'), { recursive: true });
		await writeFile(path.join(compilerRoot, 'bin', 'g++.exe'), '');
		await mkdir(path.join(localeRoot, 'zh_CN', 'LC_MESSAGES'), { recursive: true });
		await writeFile(path.join(localeRoot, 'zh_CN', 'LC_MESSAGES', 'gcc.mo'), 'localized');
		await writeFile(path.join(localeRoot, 'locale.alias'), 'alias');

		const result = await installPortableAssets({
			appRoot: toolchainRoot,
			toolchainRoot,
			assets: [{
				id: 'MinGW Lite GCC',
				urls: [],
				archiveName: 'compiler.tar.zst',
				targetDirectory: 'winlibs',
				requiredFile: 'mingw64-ucrt-15/bin/g++.exe',
				directoryToRemove: 'mingw64-ucrt-15/share/locale'
			}],
			reportProgress: () => undefined
		});

		assert.equal(result.success, true);
		await assert.rejects(readdir(localeRoot));
		assert.deepStrictEqual(await readdir(path.join(compilerRoot, 'bin')), ['g++.exe']);
	} finally {
		await rm(toolchainRoot, { recursive: true, force: true });
	}
});

test('skips missing compiler locale data', async () => {
	const toolchainRoot = await mkdtemp(path.join(os.tmpdir(), 'shortestpath-toolchain-test-'));
	try {
		await mkdir(path.join(toolchainRoot, 'winlibs', 'mingw64-ucrt-15', 'bin'), { recursive: true });
		await writeFile(path.join(toolchainRoot, 'winlibs', 'mingw64-ucrt-15', 'bin', 'g++.exe'), '');
		const result = await installPortableAssets({
			appRoot: toolchainRoot,
			toolchainRoot,
			assets: [{
				id: 'MinGW Lite GCC',
				urls: [],
				archiveName: 'compiler.zip',
				targetDirectory: 'winlibs',
				requiredFile: 'mingw64-ucrt-15/bin/g++.exe',
				directoryToRemove: 'mingw64-ucrt-15/share/locale'
			}],
			reportProgress: () => undefined
		});
		assert.equal(result.success, true);
	} finally {
		await rm(toolchainRoot, { recursive: true, force: true });
	}
});

test('removes compiler locale data after extracting a new portable toolchain', async () => {
	const toolchainRoot = await mkdtemp(path.join(os.tmpdir(), 'shortestpath-toolchain-test-'));
	const archivePath = path.join(toolchainRoot, 'compiler.zip');
	const zip = new yazl.ZipFile();
	zip.addBuffer(Buffer.from('compiler'), 'mingw64-ucrt-15/bin/g++.exe');
	zip.addBuffer(Buffer.from('localized'), 'mingw64-ucrt-15/share/locale/zh_CN/LC_MESSAGES/gcc.mo');
	zip.end();
	const archiveStream = createWriteStream(archivePath);
	zip.outputStream.pipe(archiveStream);
	await finished(archiveStream);
	try {
		const result = await installPortableAssets({
			appRoot: toolchainRoot,
			toolchainRoot,
			assets: [{
				id: 'MinGW Lite GCC',
				urls: [],
				archiveName: 'compiler.zip',
				bundledArchivePath: 'compiler.zip',
				targetDirectory: 'winlibs',
				requiredFile: 'mingw64-ucrt-15/bin/g++.exe',
				directoryToRemove: 'mingw64-ucrt-15/share/locale'
			}],
			reportProgress: () => undefined
		});

		assert.equal(result.success, true);
		await assert.rejects(readdir(path.join(toolchainRoot, 'winlibs', 'mingw64-ucrt-15', 'share', 'locale')));
	} finally {
		await rm(toolchainRoot, { recursive: true, force: true });
	}
});

test('main-process portable installer keeps locale cleanup in both preparation paths', () => {
	const appSource = readFileSync(path.resolve(__dirname, '../../../../src/vs/code/electron-main/app.ts'), 'utf8');
	const methodStart = appSource.indexOf('private async installShortestPathPortableAssets');
	const methodEnd = appSource.indexOf('private async extractShortestPathAsset', methodStart);
	const installerMethod = appSource.slice(methodStart, methodEnd);
	assert.ok(methodStart >= 0 && methodEnd > methodStart);
	const installedBranch = installerMethod.indexOf('if (fs.existsSync(join(targetPath, asset.requiredFile)))');
	const cleanupExisting = installerMethod.indexOf('await this.removeShortestPathAssetDirectory(targetPath, asset, reportProgress);', installedBranch);
	const skipExtraction = installerMethod.indexOf('continue;', cleanupExisting);
	assert.ok(installedBranch >= 0 && cleanupExisting > installedBranch && skipExtraction > cleanupExisting);

	const requiredFileCheck = installerMethod.indexOf('if (!fs.existsSync(join(targetPath, asset.requiredFile)))');
	const cleanupAfterExtraction = installerMethod.indexOf('await this.removeShortestPathAssetDirectory(targetPath, asset, reportProgress);', requiredFileCheck);
	const downloadedArchiveCleanup = installerMethod.indexOf('await fs.promises.unlink(archivePath);', cleanupAfterExtraction);
	assert.ok(requiredFileCheck >= 0 && cleanupAfterExtraction > requiredFileCheck && downloadedArchiveCleanup > cleanupAfterExtraction);
});
