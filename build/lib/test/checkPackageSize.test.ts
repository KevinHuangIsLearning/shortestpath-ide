/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { getPackageSize } from '../checkPackageSize.ts';

test('package size gate counts nested files, ignores symlink targets, and rejects the exact limit', () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'package-size-'));
	try {
		fs.mkdirSync(path.join(directory, 'nested'));
		fs.writeFileSync(path.join(directory, 'nested', 'file'), '12345');
		fs.writeFileSync(path.join(directory, 'file'), '123');
		// Windows symlink creation may require elevation; regular-file coverage still runs there.
		if (process.platform !== 'win32') { fs.symlinkSync('nested', path.join(directory, 'alias')); }
		const script = path.resolve(import.meta.dirname, '../checkPackageSize.ts');
		assert.deepStrictEqual({
			bytes: getPackageSize(directory),
			belowLimit: spawnSync(process.execPath, [script, directory, '9']).status,
			atLimit: spawnSync(process.execPath, [script, directory, '8']).status,
			invalidLimit: spawnSync(process.execPath, [script, directory, 'NaN']).status,
		}, { bytes: 8, belowLimit: 0, atLimit: 1, invalidLimit: 1 });
	} finally {
		fs.rmSync(directory, { recursive: true, force: true });
	}
});
