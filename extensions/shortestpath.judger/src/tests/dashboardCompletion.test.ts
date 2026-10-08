/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readDashboard } from '../dashboardRepository';
import { buildDashboard, DASHBOARD_TIME_LIMIT_MS } from '../dashboardStats';
import { updateDashboardCompletion, confirmAndUpdateDashboardCompletion } from '../dashboardCompletion';
import { elapsedProblemTime } from '../problemTimer';
import { Problem } from '../types';

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'dashboard-completion-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const created = new Date(2024, 1, 29, 12).getTime();
const now = new Date(2024, 2, 1, 12).getTime();

test.each([false, true])('completion patches retain legacy/modern tests and permanently freeze capped clocks (modern=%s)', async modern => {
	const file = modern ? path.join(root, 'a.prob.judger', 'problem.json') : path.join(root, 'a.prob');
	await fs.mkdir(path.dirname(file), { recursive: true });
	const metadata = { name: 'Old', url: 'https://oj.test/a', dashboardCreatedAtUnixMs: created, extra: { keep: 'literal' }, tests: [{ input: 'unchanged', output: 'data' }] };
	const original = modern ? { version: 1, generation: 'a'.repeat(32), problem: metadata, tests: [{ input: 'missing.in', output: 'missing.out' }] } : metadata;
	await fs.writeFile(file, JSON.stringify(original));
	for (const completion of ['accepted', 'partial', 'none'] as const) {
		await fs.writeFile(file, JSON.stringify(original));
		const before = await readDashboard([root]);
		const problem = buildDashboard(before.records, 2024, {}, new Date(now)).problems[0];
		updateDashboardCompletion(problem, completion, [root], now);
		const stored = JSON.parse(await fs.readFile(file, 'utf8'));
		const updated = modern ? stored.problem : stored;
		expect(updated.tests).toEqual(metadata.tests);
		expect(updated.extra).toEqual(metadata.extra);
		if (modern) { expect(stored.tests).toEqual(original.tests); expect(stored.generation).toBe('a'.repeat(32)); }
		expect(updated.dashboardCreatedAtUnixMs).toBe(created);
		expect(elapsedProblemTime(updated as Problem, now + 10 * DASHBOARD_TIME_LIMIT_MS)).toBe(DASHBOARD_TIME_LIMIT_MS);
		const after = buildDashboard((await readDashboard([root])).records, 2024, {}, new Date(now + 1000));
		expect(after.problems[0]).toMatchObject({ status: completion === 'none' ? 'unmarked' : completion, date: '2024-02-29', elapsedMs: DASHBOARD_TIME_LIMIT_MS });
		expect(after.days.find(day => day.date === '2024-02-29')?.count).toBe(1);
	}
});

test('stale snapshots, unsupported completion values and paths outside the workspace cannot write', async () => {
	const file = path.join(root, 'a.prob');
	await fs.writeFile(file, JSON.stringify({ name: 'Old', dashboardCreatedAtUnixMs: created }));
	const problem = buildDashboard((await readDashboard([root])).records, 2024, {}, new Date(now)).problems[0];
	expect(() => updateDashboardCompletion(problem, 'accepted', [path.join(root, 'elsewhere')], now)).toThrow();
	expect(() => updateDashboardCompletion(problem, 'bad' as 'accepted', [root], now)).toThrow();
	for (const patch of [{ status: 'accepted' as const }, { status: 'partial' as const }, { status: 'pending' as const }, { elapsedMs: DASHBOARD_TIME_LIMIT_MS - 1 }, { timeCapped: false }]) {
		expect(() => updateDashboardCompletion({ ...problem, ...patch }, 'accepted', [root], now)).toThrow('Invalid Dashboard completion');
	}
	await fs.writeFile(file, JSON.stringify({ name: 'Changed', dashboardCreatedAtUnixMs: created }));
	const contents = await fs.readFile(file, 'utf8');
	expect(() => updateDashboardCompletion(problem, 'accepted', [root], now)).toThrow('changed');
	expect(await fs.readFile(file, 'utf8')).toBe(contents);
});


test('cancel, dismiss and stale page after confirmation never write; only confirmed eligible records change', async () => {
	const file = path.join(root, 'a.prob');
	await fs.writeFile(file, JSON.stringify({ name: 'Old', dashboardCreatedAtUnixMs: created }));
	const problem = buildDashboard((await readDashboard([root])).records, 2024).problems[0];
	const before = await fs.readFile(file, 'utf8');
	const roots = () => [root];
	const cancel = jest.fn(async () => false);
	for (let attempt = 0; attempt < 2; attempt++) {
		expect(await confirmAndUpdateDashboardCompletion(problem, 'accepted', roots, cancel)).toBe(false);
		expect(await fs.readFile(file, 'utf8')).toBe(before);
	}
	expect(await confirmAndUpdateDashboardCompletion(problem, 'partial', roots, async () => true, () => false)).toBe(false);
	expect(await fs.readFile(file, 'utf8')).toBe(before);
	cancel.mockClear();
	expect(await confirmAndUpdateDashboardCompletion({ ...problem, status: 'accepted' }, 'partial', roots, cancel)).toBe(false);
	expect(cancel).not.toHaveBeenCalled();
	expect(await confirmAndUpdateDashboardCompletion(problem, 'partial', roots, async () => true)).toBe(true);
	expect(JSON.parse(await fs.readFile(file, 'utf8')).timePartialAcceptedAtUnixMs).toBeDefined();
});
