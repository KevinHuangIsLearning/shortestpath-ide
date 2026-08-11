/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertUniqueWorkspaceProblemRecordFileNames, getWorkspaceProblemRecordFileName } from '../workspaceProblemCache';

test('uses one stable cache file name per problem ref', () => {
	assert.equal(getWorkspaceProblemRecordFileName('ACOMB/found/A'), 'ACOMB.found.A.json');
	assert.notEqual(getWorkspaceProblemRecordFileName('a/b.c/d'), getWorkspaceProblemRecordFileName('a.b/c/d'));
	assert.equal(getWorkspaceProblemRecordFileName('a%/b.c/d'), 'a%25.b%2Ec.d.json');
	assert.equal(getWorkspaceProblemRecordFileName('a/b:c*d/d'), 'a.b%3Ac%2Ad.d.json');
	assert.equal(getWorkspaceProblemRecordFileName('CON/found/A'), '%43ON.found.A.json');
	assert.throws(() => assertUniqueWorkspaceProblemRecordFileNames(['a/b/A', 'a/b/a']), /文件名冲突/);
	assert.throws(() => getWorkspaceProblemRecordFileName(`${'a'.repeat(241)}/b/c`), /题目路径过长/);
});
