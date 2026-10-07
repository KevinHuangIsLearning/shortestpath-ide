/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { codeFolderLocation, codeFolderCandidates, existingCodeFolder } from '../rememberedCodeFolder';

test('portable Windows locations follow drive changes while unrelated disks stay absolute', () => {
	assert.deepEqual([
		codeFolderCandidates({ path: 'E:\\code', portableDataPath: 'E:\\IDE\\data' }, 'F:\\IDE\\data', path.win32),
		codeFolderCandidates({ path: 'E:\\IDE\\code', portableDataPath: 'E:\\IDE\\data' }, 'F:\\IDE\\data', path.win32),
		codeFolderCandidates({ path: 'C:\\Users\\me\\code' }, 'F:\\IDE\\data', path.win32),
		codeFolderCandidates({ path: 'C:\\code', portableDataPath: 'E:\\IDE\\data' }, 'F:\\IDE\\data', path.win32)
	], [
		['F:\\code', 'E:\\code'], ['F:\\IDE\\code', 'E:\\IDE\\code'], ['C:\\Users\\me\\code'], ['C:\\code']
	]);
});

test('malformed and relative stored locations are ignored', () => {
	assert.deepEqual([undefined, null, 'code', {}, { path: 3 }, { path: 'code' }].map(value => codeFolderCandidates(value)), [[], [], [], [], [], []]);
});

test('existing folders are recovered in priority order without accepting files or unavailable locations', t => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shortestpath-remembered-directory-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const portable = path.join(root, 'data'), code = path.join(root, 'code'), file = path.join(root, 'file');
	fs.mkdirSync(portable); fs.mkdirSync(code); fs.writeFileSync(file, '');
	const location = codeFolderLocation(code, portable);
	assert.deepEqual(location, { path: code, portableDataPath: portable });
	assert.deepEqual([
		existingCodeFolder([path.join(root, 'missing'), file, code, portable]),
		existingCodeFolder([file, path.join(root, 'missing')]),
		codeFolderLocation(code),
		codeFolderLocation(code, path.join(root, 'missing'))
	], [code, undefined, { path: code }, { path: code }]);
});
