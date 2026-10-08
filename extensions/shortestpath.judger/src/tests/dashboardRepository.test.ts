/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { readDashboard } from '../dashboardRepository';
import { buildDashboard } from '../dashboardStats';

let directory: string;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-')); });
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
async function fixture(root: string, source: string, patch = {}) {
	await fs.mkdir(path.join(root, '.shortestpath'), { recursive: true });
	await fs.writeFile(path.join(root, source), 'solution');
	const hash = crypto.createHash('md5').update(source).digest('hex');
	const file = path.join(root, '.shortestpath', `.${source}_${hash}.prob`);
	const metadata = { name: '题目', group: 'Contest', url: 'https://oj.test/a', srcPath: path.join(root, source), ...patch };
	await fs.mkdir(`${file}.judger`, { recursive: true });
	await fs.writeFile(`${file}.judger/problem.json`, JSON.stringify({ version: 1, generation: 'a'.repeat(32), problem: metadata, tests: [{ input: 'missing.in', output: 'missing.out' }] }));
	return file;
}
test('multiple roots, moved workspace via relative hash, metadata only, no writes, corrupt isolation', async () => {
	const one = path.join(directory, 'one'), two = path.join(directory, 'two');
	const file = await fixture(one, 'a.cpp', { srcPath: '/previous/workspace/a.cpp', timeAcceptedAtUnixMs: 123 });
	await fixture(two, 'b.py');
	await fs.writeFile(file, JSON.stringify({ name: 'obsolete backup' }));
	await fs.writeFile(path.join(one, '.shortestpath', 'broken.prob'), '{');
	const before = await fs.readFile(`${file}.judger/problem.json`, 'utf8');
	const data = await readDashboard([one, two]);
	expect([data.records.map(record => record.srcPath), data.skipped, await fs.readFile(`${file}.judger/problem.json`, 'utf8')]).toEqual([[path.join(one, 'a.cpp'), path.join(two, 'b.py')], 1, before]);
});
test('invalid fields and unsafe source paths retain usable records without enabling source access', async () => {
	const root = path.join(directory, 'root');
	await fs.mkdir(root);
	await fs.writeFile(path.join(root, 'a.cpp'), 'source');
	await fs.writeFile(path.join(root, 'legacy.prob'), JSON.stringify({ name: 'Old', group: '', url: '', srcPath: path.join(root, 'a.cpp'), tests: [] }));
	await fixture(root, 'b.cpp', { timeAcceptedAtUnixMs: 'bad' });
	await fs.writeFile(path.join(root, 'escape.prob'), JSON.stringify({ name: 'Escape', group: '', url: '', srcPath: '/etc/passwd', tests: [] }));
	await fs.symlink('/etc/passwd', path.join(root, 'link.cpp'));
	await fs.writeFile(path.join(root, 'link.prob'), JSON.stringify({ name: 'Link', group: '', url: '', srcPath: path.join(root, 'link.cpp'), tests: [] }));
	const result = await readDashboard([root]);
	expect([result.records.map(record => record.name).sort(), result.skipped]).toEqual([['Escape', 'Link', 'Old', '题目'], 0]);
	expect(result.records.find(record => record.name === '题目')?.timeAcceptedAtUnixMs).toBeUndefined();
	expect(result.records.filter(record => ['Escape', 'Link'].includes(record.name)).map(record => [record.srcPath, record.sourceAvailable])).toEqual([['', false], ['', false]]);
});

test('current canonical metadata wins over migration backups even after cancelling AC', async () => {
	const root = path.join(directory, 'root');
	await fixture(root, 'a.cpp');
	await fs.mkdir(path.join(root, '.cph'));
	await fs.writeFile(path.join(root, '.cph', 'old.prob'), JSON.stringify({ name: 'Backup', group: '', url: 'https://oj.test/a', srcPath: path.join(root, 'a.cpp'), timeAcceptedAtUnixMs: 123, tests: [] }));
	const result = await readDashboard([root]);
	expect(result.records.map(record => [record.name, record.timeAcceptedAtUnixMs])).toEqual([['题目', undefined]]);
});

test('configured workspace save location wins over old default metadata', async () => {
	const root = path.join(directory, 'root');
	const previous = await fixture(root, 'a.cpp', { timeAcceptedAtUnixMs: 123 });
	const custom = path.join(root, 'custom');
	await fs.mkdir(custom);
	const current = path.join(custom, path.basename(previous) + '.judger');
	await fs.mkdir(current);
	const value = JSON.parse(await fs.readFile(`${previous}.judger/problem.json`, 'utf8'));
	delete value.problem.timeAcceptedAtUnixMs;
	await fs.writeFile(path.join(current, 'problem.json'), JSON.stringify(value));
	const result = await readDashboard([root], custom);
	expect(result.records.map(record => record.timeAcceptedAtUnixMs)).toEqual([undefined]);
});


test('missing auxiliary fields and malformed optional fields do not discard legacy or modern statistics', async () => {
	const root = path.join(directory, 'root');
	const file = await fixture(root, 'a.cpp');
	const acceptedAt = new Date(2024, 2, 1, 12).getTime();
	await fs.writeFile(`${file}.judger/problem.json`, JSON.stringify({ problem: { srcPath: '/old/a.cpp', timeAcceptedAtUnixMs: acceptedAt, timeSpentMs: 1234, importedFrom: 42 } }));
	await fs.writeFile(path.join(root, 'minimal.prob'), JSON.stringify({ name: 'Minimal', timePartialAcceptedAtUnixMs: acceptedAt, timeStartedAtUnixMs: 'invalid', timeSpentMs: 5000, workspaceRelativeSourcePath: 42 }));
	const result = await readDashboard([root]);
	expect(result.skipped).toBe(0);
	expect(result.records).toHaveLength(2);
	const matched = result.records.find(record => record.srcPath.endsWith('a.cpp'))!;
	expect(matched).toMatchObject({ name: 'a.cpp', url: '', group: '', sourceAvailable: true, timeSpentMs: 1234 });
	expect(matched.importedFrom).toBeUndefined();
	expect(buildDashboard(result.records, 2024).totals).toEqual({ accepted: 1, partial: 1, unknown: 0 });
});

test('deleted and missing sources preserve historical AC and separate records without URLs', async () => {
	const root = path.join(directory, 'root');
	const acceptedAt = new Date(2024, 2, 1, 12).getTime();
	await fixture(root, 'a.cpp', { timeAcceptedAtUnixMs: acceptedAt });
	await fs.unlink(path.join(root, 'a.cpp'));
	for (const name of ['one', 'two']) {
		await fs.writeFile(path.join(root, `${name}.prob`), JSON.stringify({ name, timeAcceptedAtUnixMs: acceptedAt }));
	}
	const result = await readDashboard([root]);
	expect(result.skipped).toBe(0);
	expect(result.records.every(record => record.sourceAvailable === false)).toBe(true);
	expect(buildDashboard(result.records, 2024).totals.accepted).toBe(3);
});

test('unparseable JSON and non-object metadata remain skipped', async () => {
	await fs.mkdir(directory, { recursive: true });
	for (const [index, value] of ['{', 'null', '[]', '42', '{}'].entries()) {
		await fs.writeFile(path.join(directory, `${index}.prob`), value);
	}
	expect(await readDashboard([directory])).toEqual({ records: [], skipped: 5 });
});


test.each([[false, false], [false, true], [true, true]])('current pending metadata overrides actual CPH AC backups (moved=%s, deleted=%s)', async (moved, deleted) => {
	const root = path.join(directory, 'root');
	const current = await fixture(root, 'a.cpp');
	const value = JSON.parse(await fs.readFile(`${current}.judger/problem.json`, 'utf8'));
	if (deleted) { delete value.problem.srcPath; }
	await fs.writeFile(`${current}.judger/problem.json`, JSON.stringify(value));
	if (deleted) { await fs.unlink(path.join(root, 'a.cpp')); }
	await fs.mkdir(path.join(root, '.cph'));
	const oldSource = moved ? '/previous/workspace/a.cpp' : path.join(root, 'a.cpp');
	const oldName = `.a.cpp_${crypto.createHash('md5').update(oldSource).digest('hex')}.prob`;
	await fs.writeFile(path.join(root, '.cph', oldName), JSON.stringify({ name: 'Backup', url: 'https://oj.test/a', srcPath: oldSource, timeAcceptedAtUnixMs: 123 }));
	const result = await readDashboard([root]);
	expect(result.skipped).toBe(0);
	expect(result.records).toHaveLength(1);
	expect(result.records[0].timeAcceptedAtUnixMs).toBeUndefined();
	expect(buildDashboard(result.records).problems.map(problem => problem.status)).toEqual(['pending']);
});
