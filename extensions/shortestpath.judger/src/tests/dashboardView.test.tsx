/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DashboardHeatmap, DashboardHighlights, DashboardProblemDetails, DashboardProblemList, formatDashboardDuration } from '../webview/frontend/Dashboard';
import { buildDashboard } from '../dashboardStats';
import { translations } from '../webview/translations';

beforeEach(() => { Object.defineProperty(globalThis, 'window', { value: { translations: translations['zh-cn'] }, configurable: true }); });
afterEach(() => { Reflect.deleteProperty(globalThis, 'window'); });
test('heatmap has keyboard buttons, localized date/count labels, month labels and proportional intensity', () => {
	const html = renderToStaticMarkup(<DashboardHeatmap days={[{ date: '2024-02-29', count: 1 }, { date: '2024-03-01', count: 8 }]} selected='2024-03-01' onSelect={() => {}} />);
	// allow-any-unicode-next-line
	expect(html).toContain('aria-label="2024-02-29：1 道题目"');
	expect(html).toContain('dashboard-day level-1');
	expect(html).toContain('dashboard-day level-4 selected');
	expect(html).toContain('aria-pressed="true"');
	expect(html.match(/<button/g)).toHaveLength(2);
	expect(html.match(/<button[^>]*><\/button>/g)).toHaveLength(2);
});
test('peak dates include ties and longest completed duration excludes running problems', () => {
	const data = buildDashboard([
		// allow-any-unicode-next-line
		{ name: '<External>', url: 'https://oj.test/1', group: '比赛', srcPath: '/a.cpp', timeAcceptedAtUnixMs: new Date(2024, 1, 28).getTime(), timeSpentMs: 7200000 },
		{ name: 'B', url: 'https://oj.test/2', group: '', srcPath: '/b.cpp', timeAcceptedAtUnixMs: new Date(2024, 1, 29).getTime(), timeSpentMs: 1000 },
		{ name: 'Still running', url: 'https://oj.test/3', group: '', srcPath: '/c.cpp', timeSpentMs: 99999999 },
	] as Parameters<typeof buildDashboard>[0], 2024);
	expect(data.highlights).toMatchObject({ peakDates: ['2024-02-28', '2024-02-29'], peakCount: 1, longest: { name: '<External>', elapsedMs: 7200000 } });
	const html = renderToStaticMarkup(<DashboardHighlights data={data} />);
	// allow-any-unicode-next-line
	expect(html).toContain('AC 最多的日期');
	expect(html).toContain('2:00:00');
	expect(html).toContain('&lt;External&gt;');
	expect(html).toContain('data-i18n-ignore');
	expect(formatDashboardDuration(13500000)).toBe('3:45:00');
});
test('all supported locales cover dashboard dynamic keys and empty metrics have no invented dates', () => {
	const keys = Object.keys(translations.en).filter(key => key.startsWith('dashboard'));
	for (const dictionary of Object.values(translations)) { expect(keys.every(key => typeof dictionary[key] === 'string')).toBe(true); }
	expect(buildDashboard([], 2024).highlights).toEqual({ peakDates: [], peakCount: 0, longest: undefined });
});

test('problem details expose only Source OJ, AC/PAC and Time, keeping external content literal', () => {
	// allow-any-unicode-next-line
	const problem = { id: 'x', name: '题目', srcPath: '/a.cpp', url: 'https://luogu.com.cn/problem/P1', source: 'luogu.com.cn', importedFrom: 'Unknown platform', group: 'Hidden contest', status: 'accepted' as const, elapsedMs: 5000, stateSource: 'local' as const };
	const html = renderToStaticMarkup(<DashboardProblemDetails problem={problem} />);
	expect(html).toContain('luogu.com.cn');
	expect(html).toContain('>AC</span>');
	expect(html).toContain('0:00:05');
	// allow-any-unicode-next-line
	expect(html).not.toMatch(/Unknown platform|Hidden contest|本地标记|导入平台|比赛/);
	expect(renderToStaticMarkup(<DashboardProblemDetails problem={{ ...problem, status: 'partial' }} />)).toContain(`>${translations['zh-cn'].dashboardPartial}</span>`);
});


test('five-hour duration uses a plus suffix and unmarked records expose a localized status editor', () => {
	expect(formatDashboardDuration(5 * 3600000 - 1)).toBe('4:59:59');
	expect(formatDashboardDuration(5 * 3600000)).toBe('5:00:00+');
	expect(formatDashboardDuration(20 * 3600000)).toBe('5:00:00+');
	const problem = { id: 'a', name: 'Old', srcPath: '', url: '', source: 'unknown', importedFrom: '', group: '', status: 'unmarked' as const, elapsedMs: 5 * 3600000, stateSource: 'local' as const, recordId: '/root/a.prob', timeCapped: true };
	const html = renderToStaticMarkup(<DashboardProblemDetails problem={problem} />);
	expect(html).toContain('<select');
	expect(html).toContain(translations['zh-cn'].dashboardUnmarked);
	expect(html).toContain(translations['zh-cn'].dashboardChangeStatus);
	expect(html).not.toContain('5:00:00+');
	for (const status of ['accepted', 'partial'] as const) {
		const marked = renderToStaticMarkup(<DashboardProblemDetails problem={{ ...problem, status }} />);
		expect(marked).toContain('5:00:00+');
		expect(marked).not.toContain('<select');
	}
	expect(renderToStaticMarkup(<DashboardProblemDetails problem={{ ...problem, elapsedMs: 5 * 3600000 - 1 }} />)).not.toContain('<select');
});


test('default list includes every state in the selected period, and date filtering applies to both groups', () => {
	const now = new Date(2024, 2, 1, 12);
	const base = { name: 'Accepted Today', group: '', url: 'https://oj.test/accepted', srcPath: '', interactive: false, memoryLimit: 0, timeLimit: 0 };
	const data = buildDashboard([
		{ ...base, timeAcceptedAtUnixMs: now.getTime() },
		{ ...base, name: 'Partial Yesterday', url: 'https://oj.test/partial', timePartialAcceptedAtUnixMs: now.getTime() - 86400000 },
		{ ...base, name: 'Pending Today', url: 'https://oj.test/pending', createdAtUnixMs: now.getTime() - 1000 },
		{ ...base, name: 'Unmarked Yesterday', url: 'https://oj.test/unmarked', createdAtUnixMs: now.getTime() - 86400000 },
	], 2024, {}, now);
	const all = renderToStaticMarkup(<DashboardProblemList data={data} date='' onClear={() => {}} />);
	for (const name of ['Accepted Today', 'Partial Yesterday', 'Pending Today', 'Unmarked Yesterday']) { expect(all).toContain(name); }
	expect(all).not.toContain(translations['zh-cn'].dashboardClearDateFilter);
	const today = renderToStaticMarkup(<DashboardProblemList data={data} date='2024-03-01' onClear={() => {}} />);
	expect(today).toContain('Accepted Today');
	expect(today).toContain('Pending Today');
	expect(today).not.toContain('Yesterday');
	expect(today).toContain(translations['zh-cn'].dashboardClearDateFilter);
	const yesterday = renderToStaticMarkup(<DashboardProblemList data={data} date='2024-02-29' onClear={() => {}} />);
	expect(yesterday).toContain('Partial Yesterday');
	expect(yesterday).toContain('Unmarked Yesterday');
	expect(yesterday).not.toContain('Today');
});
