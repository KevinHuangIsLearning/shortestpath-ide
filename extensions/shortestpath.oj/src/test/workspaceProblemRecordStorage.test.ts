/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { getOwnedProblemRecordPath, listProblemRecords, ProblemRecordFileSystem, writeProblemRecordAtomically, snapshotLegacyProblemRecords, cleanLegacyProblemRecords } from '../workspaceProblemRecordStorage';

const fileSystem: ProblemRecordFileSystem = {
	readDirectory: async directory => (await fs.readdir(directory, { withFileTypes: true })).map(entry => [entry.name, entry.isDirectory() ? 2 : 1]),
	readFile: file => fs.readFile(file),
	writeFile: async (file, contents) => { await fs.writeFile(file, contents); },
	rename: (from, to) => fs.rename(from, to),
	delete: file => fs.unlink(file),
	isMissing: error => (error as NodeJS.ErrnoException).code === 'ENOENT',
};

test('publishes problem-owned records and reopens custom locations through a relative index', async () => {
	const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'oj-records-'));
	try {
		const before = path.join(folder, 'before'), root = path.join(before, '.shortestpath');
		const custom = path.join(before, 'custom', 'main.prob.judger');
		const ref = 'ACOMB/found/A';
		await fs.mkdir(root, { recursive: true }); await fs.mkdir(custom, { recursive: true });
		await fs.writeFile(path.join(root, 'ACOMB.found.A.json'), 'legacy');
		const file = getOwnedProblemRecordPath(root, ref, custom);
		await writeProblemRecordAtomically(fileSystem, file, JSON.stringify({ version: 2, problem: { ref, statement: 'body' }, submissions: ['AC'], previousStatements: ['old'], editorial: 'editorial' }));
		await writeProblemRecordAtomically(fileSystem, path.join(root, 'oj-index.json'), JSON.stringify([{ problemRef: ref, path: path.relative(root, file) }]));
		// A retained flat backup must not override the indexed record on reopen.
		const after = path.join(folder, 'after'); await fs.rename(before, after);
		const reopened = await listProblemRecords(path.join(after, '.shortestpath'), fileSystem);
		assert.deepEqual([reopened.length, reopened[0].legacy, JSON.parse(await fs.readFile(reopened[0].file, 'utf8'))], [1, false, { version: 2, problem: { ref, statement: 'body' }, submissions: ['AC'], previousStatements: ['old'], editorial: 'editorial' }]);
	} finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test('unbound problems have their own directory and multiple refs bound to one source do not overwrite each other', () => {
	const root = path.join(os.tmpdir(), 'oj-owned');
	const a = getOwnedProblemRecordPath(root, 'a/b/A');
	assert.equal(path.dirname(a), path.join(root, 'a.b.A'));
	assert.notEqual(getOwnedProblemRecordPath(root, 'a/b/A', '/source-data'), getOwnedProblemRecordPath(root, 'a/b/B', '/source-data'));
});

test('a failed atomic publication retains the previous index and migration records', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oj-failed-write-'));
	try {
		const flat = path.join(root, 'a.b.A.json'); await fs.writeFile(flat, 'old');
		const failing: ProblemRecordFileSystem = { ...fileSystem, rename: async () => { throw new Error('interrupted'); } };
		await assert.rejects(writeProblemRecordAtomically(failing, path.join(root, 'oj-index.json'), '[]'), /interrupted/);
		assert.deepEqual((await listProblemRecords(root, fileSystem)).map(record => [record.name, record.legacy]), [['a.b.A.json', true]]);
		assert.deepEqual(await fs.readdir(root), ['a.b.A.json']);
	} finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('the published index excludes obsolete problem bindings', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oj-stale-binding-'));
	try {
		const old = getOwnedProblemRecordPath(root, 'a/b/A', path.join(root, 'old.prob.judger'));
		const current = getOwnedProblemRecordPath(root, 'a/b/A');
		await fs.mkdir(path.dirname(old), { recursive: true }); await fs.mkdir(path.dirname(current), { recursive: true });
		await fs.writeFile(old, 'obsolete'); await fs.writeFile(current, JSON.stringify({ version: 2, problem: { ref: 'a/b/A' } }));
		await writeProblemRecordAtomically(fileSystem, path.join(root, 'oj-index.json'), JSON.stringify([{ problemRef: 'a/b/A', path: path.relative(root, current) }]));
		assert.deepEqual((await listProblemRecords(root, fileSystem)).map(record => record.file), [current]);
	} finally { await fs.rm(root, { recursive: true, force: true }); }
});

for (const scenario of ['success', 'changed source', 'changed index', 'missing target', 'changed target'] as const) {
	test(`legacy cleanup: ${scenario}`, async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oj-cleanup-'));
		try {
			const ref = 'a/b/A', source = path.join(root, 'a.b.A.json');
			const contents = JSON.stringify({ version: 2, problem: { ref, statement: 'body' }, editorial: 'editorial', submissions: ['AC'], previousStatements: ['old'] });
			await fs.writeFile(source, contents);
			await fs.writeFile(path.join(root, 'unrelated.json'), '{}');
			const snapshots = await snapshotLegacyProblemRecords(root, fileSystem);
			assert.equal(snapshots.length, 1);
			const target = getOwnedProblemRecordPath(root, ref);
			await fs.mkdir(path.dirname(target));
			await writeProblemRecordAtomically(fileSystem, target, contents);
			const index = [{ problemRef: ref, path: path.relative(root, target) }];
			await writeProblemRecordAtomically(fileSystem, path.join(root, 'oj-index.json'), JSON.stringify(index));
			if (scenario === 'changed source') { await fs.writeFile(source, `${contents} `); }
			if (scenario === 'changed index') { await fs.writeFile(path.join(root, 'oj-index.json'), '[]'); }
			if (scenario === 'missing target') { await fs.unlink(target); }
			if (scenario === 'changed target') { await fs.writeFile(target, '{}'); }
			await cleanLegacyProblemRecords(root, fileSystem, snapshots, index, new Map([[ref, contents]]));
			assert.equal((await fs.readdir(root)).includes('a.b.A.json'), scenario !== 'success');
			assert.equal(await fs.readFile(path.join(root, 'unrelated.json'), 'utf8'), '{}');
		} finally { await fs.rm(root, { recursive: true, force: true }); }
	});
}

test('missing indexed record falls back to its flat migration source', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oj-recovery-'));
	try {
		await fs.writeFile(path.join(root, 'a.b.A.json'), JSON.stringify({ version: 1, problem: { ref: 'a/b/A' } }));
		await fs.writeFile(path.join(root, 'oj-index.json'), JSON.stringify([{ problemRef: 'a/b/A', path: 'a.b.A/oj-a.b.A.json' }]));
		assert.ok((await listProblemRecords(root, fileSystem)).some(record => record.legacy && record.name === 'a.b.A.json'));
	} finally { await fs.rm(root, { recursive: true, force: true }); }
});


test('unsupported indexed version does not hide a valid flat source', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oj-version-recovery-'));
	try {
		await fs.writeFile(path.join(root, 'a.b.A.json'), JSON.stringify({ version: 1, problem: { ref: 'a/b/A' } }));
		const target = getOwnedProblemRecordPath(root, 'a/b/A');
		await fs.mkdir(path.dirname(target));
		await fs.writeFile(target, JSON.stringify({ version: 999, problem: { ref: 'a/b/A' } }));
		await fs.writeFile(path.join(root, 'oj-index.json'), JSON.stringify([{ problemRef: 'a/b/A', path: path.relative(root, target) }]));
		assert.ok((await listProblemRecords(root, fileSystem)).some(record => record.legacy));
	} finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('unchanged index and records cause no replacement events; changed paths publish once', async () => {
    const { writeProblemRecordIfChanged } = await import('../workspaceProblemRecordStorage');
    let contents = '[{"problemRef":"p","path":"old"}]';
    const writes: string[] = [];
    const fileSystem = {
        readFile: async () => Buffer.from(contents),
        writeFile: async (file: string, value: Uint8Array) => { writes.push(file); contents = Buffer.from(value).toString(); },
        rename: async (_: string, file: string) => { writes.push(file); },
        isMissing: () => false,
    } as unknown as import('../workspaceProblemRecordStorage').ProblemRecordFileSystem;
    await writeProblemRecordIfChanged(fileSystem, '/oj-index.json', contents);
    assert.deepEqual(writes, []);
    await writeProblemRecordIfChanged(fileSystem, '/oj-index.json', '[{"problemRef":"p","path":"new"}]');
    assert.equal(writes.length, 2);
    await writeProblemRecordIfChanged(fileSystem, '/oj-index.json', contents);
    assert.equal(writes.length, 2);
});
