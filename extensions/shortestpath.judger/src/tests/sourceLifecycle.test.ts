/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { readDashboard } from '../dashboardRepository';
import { reconcileSourceRecords, renamedSource } from '../sourceLifecycle';
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-lifecycle-')); fs.mkdirSync(path.join(root, '.shortestpath')); });
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const storage = (source: string) => path.join(root, '.shortestpath', `.${path.basename(source)}_${crypto.createHash('md5').update(path.relative(root, source)).digest('hex')}.prob`);
function fixture(source: string) {
	fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, 'code');
	const base = storage(source);
	fs.mkdirSync(`${base}.judger/tests`, { recursive: true });
	fs.writeFileSync(`${base}.judger/tests/1.in`, 'input');
	const metadata = { srcPath: source, workspaceRelativeSourcePath: path.relative(root, source), timeSpentMs: 1234, storageRevision: 'old', name: 'Problem', url: '' };
	fs.writeFileSync(`${base}.judger/problem.json`, JSON.stringify({ version: 1, problem: metadata, tests: [{ inputPath: `${base}.judger/tests/1.in`, outputPath: path.join(root, 'external.out') }] }));
	fs.writeFileSync(base, JSON.stringify(metadata));
	return base;
}
test('deleted source removes canonical records and migration backups but preserves other sources and external tests', async () => {
	const source = path.join(root, 'a.cpp'), base = fixture(source);
	const other = fixture(path.join(root, 'b.cpp'));
	fs.writeFileSync(path.join(root, 'external.out'), 'external');
	fs.mkdirSync(path.join(root, '.cph')); fs.writeFileSync(path.join(root, '.cph/backup.prob'), fs.readFileSync(base));
	fs.unlinkSync(source);
	const { records } = await readDashboard([root], undefined, true);
	expect(reconcileSourceRecords(records, [root], [], storage).deleted).toEqual([source]);
	expect(fs.existsSync(base)).toBe(false); expect(fs.existsSync(`${base}.judger`)).toBe(false);
	expect(fs.existsSync(path.join(root, '.cph/backup.prob'))).toBe(false);
	expect(fs.existsSync(`${other}.judger/problem.json`)).toBe(true);
	expect(fs.readFileSync(path.join(root, 'external.out'), 'utf8')).toBe('external');
	expect((await readDashboard([root])).records).toHaveLength(1);
});
test('directory rename preserves timing, tests and external paths while relocating canonical storage', async () => {
	const source = path.join(root, 'old/a.cpp'), base = fixture(source);
	const records = (await readDashboard([root], undefined, true)).records;
	fs.renameSync(path.join(root, 'old'), path.join(root, 'new'));
	const next = path.join(root, 'new/a.cpp'), destination = storage(next);
	expect(reconcileSourceRecords(records, [root], [{ oldPath: path.join(root, 'old'), newPath: path.join(root, 'new') }], storage).renamed).toEqual([{ oldPath: source, newPath: next }]);
	const stored = JSON.parse(fs.readFileSync(`${destination}.judger/problem.json`, 'utf8'));
	expect(stored.problem).toMatchObject({ srcPath: next, workspaceRelativeSourcePath: 'new/a.cpp', timeSpentMs: 1234 });
	expect(stored.problem.storageRevision).not.toBe('old');
	expect(stored.tests[0]).toEqual({ inputPath: `${destination}.judger/tests/1.in`, outputPath: path.join(root, 'external.out') });
	expect(fs.readFileSync(stored.tests[0].inputPath, 'utf8')).toBe('input');
	expect(fs.existsSync(`${base}.judger`)).toBe(false);
});
test('unbound and outside-workspace metadata cannot trigger cleanup', () => {
	const source = path.join(root, 'a.cpp'), base = fixture(source);
	const records = [{ recordId: base, srcPath: '' }, { recordId: base, srcPath: '/missing/outside.cpp' }] as Parameters<typeof reconcileSourceRecords>[0];
	expect(reconcileSourceRecords(records, [root], [], storage)).toEqual({ deleted: [], renamed: [] });
	expect(fs.existsSync(base)).toBe(true);
});

test('successive file and directory renames resolve the final source path', () => {
	expect(renamedSource('/root/a.cpp', [{ oldPath: '/root/a.cpp', newPath: '/root/b.cpp' }, { oldPath: '/root/b.cpp', newPath: '/root/c.cpp' }])).toBe('/root/c.cpp');
});
test('shared custom storage cannot delete records belonging to another workspace', async () => {
	const source = path.join(root, 'other/a.cpp'); fixture(source);
	const unrelated = path.join(root, 'unrelated'); fs.mkdirSync(unrelated);
	const result = await readDashboard([unrelated], path.join(root, '.shortestpath'), true);
	expect(result.records).toHaveLength(0);
	expect(fs.existsSync(`${storage(source)}.judger/problem.json`)).toBe(true);
});

test('concurrent metadata updates are retried without consuming source renames', async () => {
	const source = path.join(root, 'a.cpp'), base = fixture(source), next = path.join(root, 'b.cpp');
	const records = (await readDashboard([root], undefined, true)).records;
	const stored = JSON.parse(fs.readFileSync(`${base}.judger/problem.json`, 'utf8'));
	stored.problem.timeSpentMs = 9999;
	fs.writeFileSync(`${base}.judger/problem.json`, JSON.stringify(stored)); fs.renameSync(source, next);
	const renames = [{ oldPath: source, newPath: next }];
	expect(() => reconcileSourceRecords(records, [root], renames, storage)).toThrow('Source record changed');
	const latest = (await readDashboard([root], undefined, true)).records;
	expect(reconcileSourceRecords(latest, [root], renames, storage).renamed).toEqual(renames);
	expect(JSON.parse(fs.readFileSync(`${storage(next)}.judger/problem.json`, 'utf8')).problem.timeSpentMs).toBe(9999);
});

test('stale batches cannot partially delete records before notifications are returned', async () => {
	const one = path.join(root, 'a.cpp'), first = fixture(one), two = path.join(root, 'b.cpp'), second = fixture(two);
	const records = (await readDashboard([root], undefined, true)).records;
	fs.unlinkSync(one);
	fs.writeFileSync(`${second}.judger/problem.json`, fs.readFileSync(`${second}.judger/problem.json`, 'utf8') + ' ');
	expect(() => reconcileSourceRecords(records, [root], [], storage)).toThrow('Source record changed');
	expect(fs.existsSync(`${first}.judger/problem.json`)).toBe(true);
	expect(reconcileSourceRecords((await readDashboard([root], undefined, true)).records, [root], [], storage).deleted).toEqual([one]);
});
