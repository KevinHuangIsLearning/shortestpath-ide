/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as protectedReaderHost from '../protectedReaderHost';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applySourceFileChanges } from '../sourceFileChanges';
test('deletion clears every local cache map while rename preserves data', () => {
	const cache = { sourcePaths: { a: '/workspace/a.cpp', b: '/workspace/b.cpp' }, problems: { a: { timer: 123 }, b: { timer: 456 } }, submissions: { a: [], b: [] }, editorials: { a: {}, b: {} }, previousStatements: { a: [], b: [] }, lastUsedAt: { a: 1, b: 2 }, recoveryContexts: { a: {}, b: {} } };
	assert.deepEqual(applySourceFileChanges(cache, { deleted: ['/workspace/a.cpp'], renamed: [{ oldPath: '/workspace/b.cpp', newPath: '/workspace/new.cpp' }] }), ['a']);
	for (const map of Object.values(cache)) { assert.equal(Object.hasOwn(map, 'a'), false); }
	assert.equal(cache.sourcePaths.b, '/workspace/new.cpp');
	assert.deepEqual(cache.problems.b, { timer: 456 });
});

test('cache writer preserves indexed record locations across source rename and reread', async () => {
	const compiled = fs.readFileSync(path.join(__dirname, '../extension.js'), 'utf8');
	const start = compiled.indexOf('async function writeWorkspaceProblemCache('), end = compiled.indexOf('function mutateWorkspaceProblemCache', start);
	assert.ok(start > 0 && end > start);
	const files = new Map<string, Uint8Array>();
	const cache = { problems: { ref: { ref: 'ref' } }, sourcePaths: { ref: '/workspace/a.cpp' }, recoveryContexts: {}, submissions: {}, editorials: {}, previousStatements: {}, lastUsedAt: {} };
	const locations = new WeakMap<object, Map<string, string>>([[cache, new Map([['ref', '/cache/nested/oj-ref.json']])]]);
	const records = new WeakMap<object, Map<string, string>>();
	const writer = vm.runInNewContext(compiled.slice(start, end) + '\nwriteWorkspaceProblemCache', {
		TextEncoder, vscode: { workspace: { fs: { createDirectory: async () => {}, writeFile: async (file: string, contents: Uint8Array) => { files.set(file, contents); } } } },
		getWorkspaceCacheDirectoryUri: () => '/cache', protectedReaderHost_1: protectedReaderHost, workspaceProblemCache_1: { assertUniqueWorkspaceProblemRecordFileNames: () => {}, getWorkspaceProblemCacheEvictions: () => [], getWorkspaceProblemRecoveryContext: () => ({}) },
		assertUniqueWorkspaceProblemRecordFileNames: () => {}, getWorkspaceProblemCacheEvictions: () => [],
		getWorkspaceProblemRecoveryContext: () => ({}), workspaceCacheSourceContents: new WeakMap(), workspaceCacheRecordContents: records, workspaceCacheRecordLocations: locations,
		getWorkspaceSourceIndexUri: () => '/cache/.source-paths.json', workspaceProblemRecordVersion: 2,
		getWorkspaceProblemRecordUri: () => '/cache/ref.json', problemRecordUri: (_directory: unknown, file: string) => file,
		workspaceCachesNeedingRewrite: new WeakSet(), hintAnswerCache: new Map(),
	}) as (cache: object) => Promise<void>;
	applySourceFileChanges(cache, { deleted: [], renamed: [{ oldPath: '/workspace/a.cpp', newPath: '/workspace/b.cpp' }] });
	await writer(cache);
	assert.equal(JSON.parse(new TextDecoder().decode(files.get('/cache/nested/oj-ref.json'))).sourcePath, '/workspace/b.cpp');
	assert.equal(files.has('/cache/ref.json'), false);
});
