/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { installPortableAssets } from '../portableToolchainInstaller';

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
