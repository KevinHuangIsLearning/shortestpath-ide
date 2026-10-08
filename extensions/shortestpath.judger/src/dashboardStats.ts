/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Problem } from './types';
import { elapsedProblemTime } from './problemTimer';

export const DASHBOARD_TIME_LIMIT_MS = 5 * 60 * 60 * 1000;
export type DashboardCompletion = 'none' | 'partial' | 'accepted';
export type DashboardRecord = Omit<Problem, 'tests'> & { serverAccepted?: boolean; serverRunning?: boolean; serverElapsedMs?: number; originalUrl?: string; recordId?: string; recordFingerprint?: string; sourceAvailable?: boolean; createdAtUnixMs?: number; dashboardTimeCapped?: boolean; dashboardCompletion?: DashboardCompletion };
export type DashboardStatus = 'accepted' | 'partial' | 'pending' | 'unmarked';
export type DashboardProblem = {
	id: string; name: string; url: string; srcPath: string; group: string; sourceAvailable?: boolean; recordId?: string; recordFingerprint?: string; createdAtUnixMs?: number; timeCapped?: boolean; creationActivity?: boolean; clockRunning?: boolean;
	source: string; importedFrom: string; status: DashboardStatus;
	date?: string; elapsedMs: number; stateSource: 'local' | 'server';
};
/** Only unmarked records that have reached the timer limit can be marked here. */
export function canSetDashboardCompletion(problem: DashboardProblem): boolean {
	return problem.status === 'unmarked' && problem.timeCapped === true && problem.elapsedMs >= DASHBOARD_TIME_LIMIT_MS && !!problem.recordId;
}
export type DashboardFilter = { source?: string; status?: DashboardStatus };
export type DashboardData = {
	revision: number; nextRefreshMs?: number; days: { date: string; count: number }[]; problems: DashboardProblem[];
	sources: string[]; highlights: { peakDates: string[]; peakCount: number; longest?: DashboardProblem }; totals: { accepted: number; partial: number; unknown: number }; skipped: number;
};
export type DashboardRange = { start: string; end: string };
export type DashboardRequest =
	| { command: 'dashboard-load'; year?: number; range?: DashboardRange; filter?: DashboardFilter }
	| { command: 'dashboard-set-completion'; problemId: string; completion: DashboardCompletion }
	| { command: 'dashboard-open-source' | 'dashboard-open-url'; problemId: string };

/** Calendar dates use the host's local timezone, without UTC conversion. */
export function dashboardDate(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
/** Validate local calendar boundaries and bound the number of rendered day cells. */
export function validDashboardRange(range: DashboardRange): boolean {
	const parse = (value: string): Date | undefined => {
		if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) { return undefined; }
		const date = new Date(`${value}T00:00:00`);
		return !Number.isNaN(date.getTime()) && dashboardDate(date) === value ? date : undefined;
	};
	const start = parse(range.start), end = parse(range.end);
	return !!start && !!end && start <= end && (Date.parse(`${range.end}T00:00:00Z`) - Date.parse(`${range.start}T00:00:00Z`)) / 86400000 < 36600;
}
export function dashboardDomain(url: string): string {
	try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./, '') : ''; } catch { return ''; }
}
/** Keep query identities but discard tracking parameters, fragments and trailing slashes. */
export function dashboardIdentity(problem: DashboardRecord): string {
	try {
		const url = new URL(problem.originalUrl || problem.url);
		if (!/^https?:$/.test(url.protocol)) { throw new Error('Not HTTP'); }
		url.protocol = 'https:'; url.hostname = url.hostname.replace(/^www\./, '');
		url.hash = ''; url.pathname = url.pathname.replace(/\/$/, '') || '/';
		for (const key of [...url.searchParams.keys()]) { if (/^(utm_|fbclid$|gclid$)/.test(key)) { url.searchParams.delete(key); } }
		url.searchParams.sort();
		return url.toString();
	} catch { return problem.srcPath || problem.recordId || ''; }
}
/** AC wins across solution copies; latest AC date is the single counted date. */
export function buildDashboard(records: DashboardRecord[], year?: number, filter: DashboardFilter = {}, now = new Date(), range?: DashboardRange): DashboardData {
	const merged = new Map<string, DashboardProblem>();
	const priority = { accepted: 3, partial: 2, unmarked: 1, pending: 0 };
	for (const record of records) {
		const server = record.serverAccepted !== undefined;
		const marked = record.dashboardCompletion;
		const accepted = marked ? marked === 'accepted' : server ? record.serverAccepted : record.timeAcceptedAtUnixMs !== undefined;
		const partial = marked ? marked === 'partial' : !server && !accepted && record.timePartialAcceptedAtUnixMs !== undefined;
		const timestamp = server && !marked ? undefined : accepted ? record.timeAcceptedAtUnixMs : partial ? record.timePartialAcceptedAtUnixMs : undefined;
		const created = record.createdAtUnixMs;
		const elapsed = server && !marked ? record.serverElapsedMs ?? 0 : record.timeStartedAtUnixMs !== undefined || record.dashboardTimeCapped ? elapsedProblemTime({ ...record, tests: [] }, now.getTime()) : !accepted && !partial && created !== undefined ? Math.max(0, now.getTime() - created, record.timeSpentMs ?? 0) : record.timeSpentMs ?? 0;
		const capped = record.dashboardTimeCapped === true || elapsed >= DASHBOARD_TIME_LIMIT_MS;
		const unmarked = !accepted && !partial && capped;
		const creationActivity = unmarked || record.dashboardTimeCapped === true || accepted && timestamp === undefined && created !== undefined;
		const activityTime = creationActivity ? created : timestamp ?? created;
		const id = dashboardIdentity(record);
		const problem: DashboardProblem = {
			id, name: record.name, url: record.originalUrl || record.url, srcPath: record.srcPath, group: record.group, sourceAvailable: record.sourceAvailable,
			recordId: record.recordId, recordFingerprint: record.recordFingerprint, createdAtUnixMs: created, timeCapped: capped, creationActivity, clockRunning: server && !marked ? record.serverRunning === true : created !== undefined || record.timeStartedAtUnixMs !== undefined,
			source: record.local ? 'local' : dashboardDomain(record.originalUrl || record.url) || 'unknown',
			importedFrom: record.importedFrom || dashboardDomain(record.importedUrl || '') || (dashboardDomain(record.url) === 'vjudge.net' ? 'vjudge.net' : 'unknown'),
			status: accepted ? 'accepted' : partial ? 'partial' : unmarked ? 'unmarked' : 'pending',
			date: activityTime !== undefined && Number.isFinite(activityTime) && !Number.isNaN(new Date(activityTime).getTime()) ? dashboardDate(new Date(activityTime)) : undefined,
			elapsedMs: capped ? DASHBOARD_TIME_LIMIT_MS : elapsed, stateSource: server ? 'server' : 'local',
		};
		const previous = merged.get(id);
		if (!previous || priority[problem.status] > priority[previous.status] || priority[problem.status] === priority[previous.status] && (problem.date || '') > (previous.date || '')) { merged.set(id, problem); }
	}
	const sources = [...new Set([...merged.values()].map(problem => problem.source))].sort();
	const days: DashboardData['days'] = [];
	if (range && !validDashboardRange(range)) { throw new Error('Invalid Dashboard range'); }
	const first = range ? new Date(`${range.start}T00:00:00`) : year === undefined ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 179) : new Date(year, 0, 1);
	const end = range ? new Date(`${range.end}T00:00:00`) : year === undefined ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : new Date(year, 11, 31);
	for (const date = new Date(first); date <= end; date.setDate(date.getDate() + 1)) { days.push({ date: dashboardDate(date), count: 0 }); }
	const counts = new Map(days.map(day => [day.date, day]));
	const problems = [...merged.values()].filter(problem => (!filter.source || problem.source === filter.source) && (!filter.status || problem.status === filter.status) && (!problem.date || counts.has(problem.date))).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.name.localeCompare(b.name));
	for (const problem of problems) { if ((problem.status === 'accepted' || problem.creationActivity) && problem.date) { counts.get(problem.date)!.count++; } }
	const acceptedCounts = new Map(days.map(day => [day.date, 0]));
	for (const problem of problems) { if (problem.status === 'accepted' && problem.date) { acceptedCounts.set(problem.date, acceptedCounts.get(problem.date)! + 1); } }
	const peakCount = Math.max(0, ...acceptedCounts.values());
	const completed = problems.filter(problem => problem.status === 'accepted' || problem.status === 'partial');
	const longest = completed.reduce<DashboardProblem | undefined>((result, problem) => !result || problem.elapsedMs > result.elapsedMs ? problem : result, undefined);
	return {
		revision: 0, nextRefreshMs: [...merged.values()].filter(problem => problem.status === 'pending' && problem.clockRunning).reduce<number | undefined>((delay, problem) => Math.min(delay ?? DASHBOARD_TIME_LIMIT_MS, DASHBOARD_TIME_LIMIT_MS - problem.elapsedMs), undefined), days, sources, problems, highlights: { peakCount, peakDates: peakCount ? days.filter(day => acceptedCounts.get(day.date) === peakCount).map(day => day.date) : [], longest }, totals: {
			accepted: problems.filter(problem => problem.status === 'accepted').length,
			partial: problems.filter(problem => problem.status === 'partial').length,
			unknown: problems.filter(problem => (problem.status === 'accepted' || problem.status === 'partial') && !problem.date).length,
		}, skipped: 0
	};
}
