/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { buildDashboard, dashboardDate, dashboardIdentity, DashboardRecord, validDashboardRange, DASHBOARD_TIME_LIMIT_MS } from '../dashboardStats';
import { setProblemCompletion, elapsedOjTime } from '../problemTimer';
import { Problem } from '../types';

const now = new Date(2024, 2, 1, 12);
const record = (patch: Partial<DashboardRecord> = {}): DashboardRecord => ({ name: 'External <题名>', group: 'External contest', url: 'https://codeforces.com/problemset/problem/1/A', srcPath: '/root/main.cpp', interactive: false, timeLimit: 1000, memoryLimit: 256, ...patch });

test('180 local calendar dates, midnight boundary, leap year and partial AC separation', () => {
	const midnight = new Date(2024, 1, 29, 0).getTime();
	const data = buildDashboard([
		record({ timeAcceptedAtUnixMs: midnight }),
		record({ url: 'https://atcoder.jp/tasks/a', timeAcceptedAtUnixMs: midnight - 1 }),
		record({ url: 'https://luogu.com.cn/problem/P1', timePartialAcceptedAtUnixMs: midnight }),
	], undefined, {}, now);
	expect([data.days.length, data.days[data.days.length - 1].date, data.totals, data.days.filter(day => day.count)]).toEqual([180, '2024-03-01', { accepted: 2, partial: 1, unknown: 0 }, [{ date: '2024-02-28', count: 1 }, { date: '2024-02-29', count: 1 }]]);
	expect(buildDashboard([], 2024).days.length).toBe(366);
	expect(buildDashboard([], 2023).days.length).toBe(365);
	expect(dashboardDate(new Date(2024, 0, 1))).toBe('2024-01-01');
});

test('merge solutions by normalized URL, AC wins and latest accepted copy supplies the date', () => {
	const data = buildDashboard([
		record({ timePartialAcceptedAtUnixMs: now.getTime() }),
		record({ srcPath: '/root/old.cpp', timeAcceptedAtUnixMs: new Date(2024, 1, 29).getTime() }),
		record({ url: 'http://www.codeforces.com/problemset/problem/1/A/?utm_source=x#statement', srcPath: '/root/new.cpp', timeAcceptedAtUnixMs: now.getTime() }),
	], undefined, {}, now);
	expect([data.totals, data.problems.map(problem => [problem.srcPath, problem.date])]).toEqual([{ accepted: 1, partial: 0, unknown: 0 }, [['/root/new.cpp', '2024-03-01']]]);
	expect(dashboardIdentity(record({ url: '' }))).toBe('/root/main.cpp');
	expect(dashboardIdentity(record({ url: 'https://oj.test/problem?id=1' }))).not.toBe(dashboardIdentity(record({ url: 'https://oj.test/problem?id=2' })));
});

test('cancel removes AC and remark uses the new local date', () => {
	const initial = { ...record(), tests: [] } as Problem;
	const accepted = setProblemCompletion(initial, 'accepted', new Date(2024, 1, 29).getTime());
	const resumed = setProblemCompletion(accepted, 'none', now.getTime());
	const remarked = setProblemCompletion(resumed, 'accepted', now.getTime());
	expect([buildDashboard([resumed], undefined, {}, now).totals.accepted, buildDashboard([remarked], undefined, {}, now).problems[0].date]).toEqual([0, '2024-03-01']);
});

test('server cache has unknown historical date; filters do not mix partial into heatmap', () => {
	const records = [record({ serverAccepted: true, serverElapsedMs: 100, timeAcceptedAtUnixMs: now.getTime() }), record({ url: '', local: true, srcPath: '/root/local.cpp', timePartialAcceptedAtUnixMs: now.getTime() })];
	const data = buildDashboard(records, undefined, {}, now);
	expect([data.totals, data.days.some(day => day.count), data.problems[1].stateSource]).toEqual([{ accepted: 1, partial: 1, unknown: 1 }, false, 'server']);
	expect(buildDashboard(records, undefined, { source: 'local', status: 'partial' }, now).totals).toEqual({ accepted: 0, partial: 1, unknown: 0 });
});

test('URL-derived OJ, captured import platform and original group/name remain intact', () => {
	const data = buildDashboard([record({ importedFrom: 'vjudge.net', importedUrl: 'https://vjudge.net/problem/CodeForces-1A' })], undefined, {}, now);
	expect(data.problems[0]).toMatchObject({ name: 'External <题名>', group: 'External contest', source: 'codeforces.com', importedFrom: 'vjudge.net', stateSource: 'local' });
	const legacy = buildDashboard([record({ url: 'https://vjudge.net/problem/CodeForces-1A', originalUrl: 'https://codeforces.com/problemset/problem/1/A' })], undefined, {}, now);
	expect(legacy.problems[0]).toMatchObject({ source: 'codeforces.com', importedFrom: 'vjudge.net' });
});

test('custom date ranges are inclusive and reject invalid or reversed calendar boundaries', () => {
	const data = buildDashboard([], undefined, {}, now, { start: '2024-02-28', end: '2024-03-01' });
	expect(data.days.map(day => day.date)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
	expect([validDashboardRange({ start: '2024-02-30', end: '2024-03-01' }), validDashboardRange({ start: '2024-03-01', end: '2024-02-28' }), validDashboardRange({ start: '2024-02-29', end: '2024-02-29' })]).toEqual([false, false, true]);
});


test('unmarked old records count on creation date while five-hour totals never pretend to be AC', () => {
	const created = new Date(2024, 1, 29, 12).getTime();
	const old = record({ createdAtUnixMs: created });
	const recent = record({ url: 'https://oj.test/new', createdAtUnixMs: now.getTime() - DASHBOARD_TIME_LIMIT_MS + 1 });
	const data = buildDashboard([old, recent], 2024, {}, now);
	expect(data.problems.find(problem => problem.id.includes('codeforces'))).toMatchObject({ status: 'unmarked', date: '2024-02-29', elapsedMs: DASHBOARD_TIME_LIMIT_MS, timeCapped: true });
	expect(data.problems.find(problem => problem.id.includes('oj.test'))?.status).toBe('pending');
	expect(data.days.find(day => day.date === '2024-02-29')?.count).toBe(1);
	expect(data.totals.accepted).toBe(0);
	expect(data.highlights.peakCount).toBe(0);
	expect(data.highlights.longest).toBeUndefined();
	expect(data.nextRefreshMs).toBe(1);
});

test('capped marking keeps creation date and 5h for AC, partial AC and cleared states', () => {
	const created = new Date(2024, 1, 29, 12).getTime();
	for (const completion of ['accepted', 'partial', 'none'] as const) {
		const data = buildDashboard([record({ createdAtUnixMs: created, dashboardTimeCapped: true, dashboardCompletion: completion, timeAcceptedAtUnixMs: completion === 'accepted' ? now.getTime() : undefined, timePartialAcceptedAtUnixMs: completion === 'partial' ? now.getTime() : undefined })], 2024, {}, now);
		expect(data.problems[0]).toMatchObject({ status: completion === 'none' ? 'unmarked' : completion, date: '2024-02-29', elapsedMs: DASHBOARD_TIME_LIMIT_MS });
		expect(data.days.find(day => day.date === '2024-02-29')?.count).toBe(1);
	}
	expect(buildDashboard([record({ serverAccepted: true, createdAtUnixMs: created })], 2024, {}, now).problems[0].date).toBe('2024-02-29');
});


test('running server snapshots cross the five-hour deadline while paused snapshots remain frozen', () => {
	const timer = { elapsedMs: DASHBOARD_TIME_LIMIT_MS - 60000, capturedAtUnixMs: now.getTime(), mode: 'timed' as const, running: true, accepted: false };
	const created = now.getTime() - 86400000;
	const snapshot = (running: boolean, after: number) => buildDashboard([record({ serverAccepted: false, serverRunning: running, serverElapsedMs: elapsedOjTime({ ...timer, running }, now.getTime() + after), createdAtUnixMs: created })], 2024, {}, new Date(now.getTime() + after));
	expect(snapshot(true, 0).nextRefreshMs).toBe(60000);
	expect(snapshot(true, 60000).problems[0]).toMatchObject({ status: 'unmarked', date: '2024-02-29', elapsedMs: DASHBOARD_TIME_LIMIT_MS });
	expect(snapshot(false, 60000).problems[0].status).toBe('pending');
	expect(snapshot(false, 60000).nextRefreshMs).toBeUndefined();
});

test('period filters include pending creation dates and exclude records created outside the selected range', () => {
	const data = buildDashboard([record({ createdAtUnixMs: now.getTime() - 1000 }), record({ url: 'https://oj.test/older', createdAtUnixMs: new Date(2023, 0, 1).getTime() })], undefined, {}, now, { start: '2024-03-01', end: '2024-03-01' });
	expect(data.problems.map(problem => problem.status)).toEqual(['pending']);
});
