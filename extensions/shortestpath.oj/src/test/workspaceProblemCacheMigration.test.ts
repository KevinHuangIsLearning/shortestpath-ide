/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateLegacyWorkspaceCache } from '../workspaceProblemCacheMigration';

test('writes merged per-problem cache before deleting the legacy aggregate', async () => {
	type Cache = { old?: string; current?: string };
	const calls: string[] = [];
	const migrated = await migrateLegacyWorkspaceCache<Cache>({
		readLegacy: async () => ({ old: 'legacy', current: undefined }),
		readCurrent: async () => ({ old: undefined, current: 'new' }),
		merge: (current, legacy) => ({ ...legacy, ...current }),
		writeCurrent: async () => { calls.push('write'); },
		deleteLegacy: async () => { calls.push('delete'); },
	});
	assert.deepStrictEqual({ migrated, calls }, { migrated: true, calls: ['write', 'delete'] });
});

test('does not delete the legacy aggregate when writing new records fails', async () => {
	type Cache = { old?: string; current?: string };
	let deleted = false;
	await assert.rejects(migrateLegacyWorkspaceCache<Cache>({
		readLegacy: async () => ({ old: 'legacy', current: undefined }),
		readCurrent: async () => ({ old: undefined, current: 'new' }),
		merge: current => current,
		writeCurrent: async () => { throw new Error('write failed'); },
		deleteLegacy: async () => { deleted = true; },
	}), /write failed/);
	assert.equal(deleted, false);
});

test('does not scan current records when no aggregate needs migration', async () => {
	let scanned = false;
	assert.equal(await migrateLegacyWorkspaceCache({
		readLegacy: async () => undefined,
		readCurrent: async () => { scanned = true; return {}; },
		merge: current => current, writeCurrent: async () => {}, deleteLegacy: async () => {},
	}), false);
	assert.equal(scanned, false);
});
