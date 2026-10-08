/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardData, DashboardProblem, DashboardRequest, DashboardStatus, DashboardRange, dashboardDate, validDashboardRange, DASHBOARD_TIME_LIMIT_MS, canSetDashboardCompletion } from '../../dashboardStats';
import { t } from './i18n';

declare const vscodeApi: { postMessage(message: DashboardRequest): void };
const label = (source: string) => source === 'local' ? t('dashboardLocal') : source === 'unknown' ? t('dashboardUnknownSource') : source;
const statusLabel = (status: DashboardStatus) => t(status === 'accepted' ? 'dashboardAccepted' : status === 'partial' ? 'dashboardPartial' : status === 'unmarked' ? 'dashboardUnmarked' : 'dashboardPending');

/** Keep the duration legible without depending on translated unit abbreviations. */
export function formatDashboardDuration(ms: number): string {
	if (ms >= DASHBOARD_TIME_LIMIT_MS) { return '5:00:00+'; }
	const seconds = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
export function DashboardHighlights({ data }: { data: DashboardData }) {
	const metrics = [
		{ value: String(data.totals.accepted), label: t('dashboardAccepted') },
		{ value: data.highlights.peakDates.join(', ') || '—', label: t('dashboardPeakDay') },
		{ value: data.highlights.peakCount ? t('dashboardCount').replace('{count}', String(data.highlights.peakCount)) : '—', label: t('dashboardPeakCount') },
		{ value: data.highlights.longest ? formatDashboardDuration(data.highlights.longest.elapsedMs) : '—', label: t('dashboardLongest'), detail: data.highlights.longest?.name },
		{ value: String(data.totals.partial), label: t('dashboardPartial') },
	];
	return <section className='dashboard-totals' aria-label={t('dashboard')}>
		{metrics.map(metric => <div key={metric.label} className='dashboard-metric'><strong title={metric.detail}>{metric.value}</strong><span>{metric.label}</span>{metric.detail && <small data-i18n-ignore>{metric.detail}</small>}</div>)}
	</section>;
}
export function DashboardHeatmap({ days, selected, onSelect }: { days: DashboardData['days']; selected: string; onSelect(date: string): void }) {
	const first = days[0]?.date;
	const padding = first ? new Date(`${first}T12:00:00`).getDay() : 0;
	const weeks = Math.ceil((padding + days.length) / 7);
	const max = Math.max(1, ...days.map(day => day.count));
	const months = days.map((day, index) => ({ date: new Date(`${day.date}T12:00:00`), week: Math.floor((index + padding) / 7) })).filter((item, index) => index === 0 || item.date.getDate() === 1);
	return <>
		<div className='dashboard-scroll'><div className='dashboard-calendar'>
			<div className='dashboard-heatmap' role='group' aria-label={t('dashboardActivity')}>
				{Array.from({ length: padding }, (_, index) => <span key={`pad-${index}`} aria-hidden='true' />)}
				{days.map(day => {
					const level = day.count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil(day.count / max * 4)));
					const description = t('dashboardDay').replace('{date}', day.date).replace('{count}', String(day.count));
					return <button key={day.date} className={`dashboard-day level-${level}${selected === day.date ? ' selected' : ''}`} aria-pressed={selected === day.date} aria-label={description} title={description} onClick={() => onSelect(day.date)}></button>;
				})}
			</div>
			<div className='dashboard-months'>{Array.from({ length: weeks }, (_, week) => <span key={week}>{months.filter(month => month.week === week).map(month => month.date.toLocaleDateString(typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en', { month: 'short' })).join(' / ')}</span>)}</div>
		</div></div>
		<div className='dashboard-legend'>{t('dashboardLess')}{[0, 1, 2, 3, 4].map(level => <span key={level} className={`dashboard-day level-${level}`} aria-hidden='true' />)}{t('dashboardMore')}</div>
	</>;
}

/** The compact detail row keeps only the OJ, completion badge and duration. */
export function DashboardProblemDetails({ problem }: { problem: DashboardProblem }) {
	return <div className='dashboard-problem-details'>
		<dl><dt>{t('dashboardSource')}</dt><dd data-i18n-ignore>{label(problem.source)}</dd></dl>
		{canSetDashboardCompletion(problem) ? <select className={`dashboard-status dashboard-status-${problem.status}`} aria-label={t('dashboardChangeStatus')} value='none' onChange={event => vscodeApi.postMessage({ command: 'dashboard-set-completion', problemId: problem.id, completion: event.target.value as 'none' | 'partial' | 'accepted' })}><option value='none'>{t('dashboardUnmarked')}</option><option value='accepted'>AC</option><option value='partial'>{t('dashboardPartial')}</option></select> : <span className={`dashboard-status dashboard-status-${problem.status}`}>{problem.status === 'accepted' ? 'AC' : statusLabel(problem.status)}</span>}
		<dl><dt>{t('dashboardDetailTime')}</dt><dd>{problem.status === 'unmarked' ? t('dashboardUnmarked') : formatDashboardDuration(problem.elapsedMs)}</dd></dl>
	</div>;
}

export function recentDashboardRange(days: number, now = new Date()): DashboardRange {
	return { start: dashboardDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1)), end: dashboardDate(now) };
}

export function DashboardProblemList({ data, date, onClear }: { data: DashboardData; date: string; onClear(): void }) {
	const visible = data.problems.filter(problem => !date || problem.date === date);
	const unmarked = visible.filter(problem => problem.status === 'unmarked');
	const rows = (problems: DashboardProblem[]) => problems.length === 0 ? <p>{t('dashboardEmpty')}</p> : <ul className='dashboard-problems'>{problems.map(problem => <li key={problem.id}>
		<strong className='dashboard-problem-name' title={problem.name} data-i18n-ignore>{problem.name}</strong>
		<DashboardProblemDetails problem={problem} />
		<span className='dashboard-problem-actions'><button disabled={problem.sourceAvailable === false} onClick={() => vscodeApi.postMessage({ command: 'dashboard-open-source', problemId: problem.id })}>{t('dashboardOpenSource')}</button>{/^https?:/.test(problem.url) && <button onClick={() => vscodeApi.postMessage({ command: 'dashboard-open-url', problemId: problem.id })}>{t('dashboardOpenUrl')}</button>}</span>
	</li>)}</ul>;
	return <>
		<div className='dashboard-section-heading'><h2>{date || t('dashboardAllProblems')}</h2>{date && <button onClick={onClear}>{t('dashboardClearDateFilter')}</button>}</div>
		{rows(visible.filter(problem => problem.status !== 'unmarked'))}
		{unmarked.length > 0 && <><h2>{t('dashboardUnmarked')} ({unmarked.length})</h2>{rows(unmarked)}</>}
	</>;
}

export function Dashboard() {
	const [data, setData] = useState<DashboardData>();
	const [period, setPeriod] = useState('recent180');
	const [customRange, setCustomRange] = useState<DashboardRange>(() => recentDashboardRange(180));
	const [appliedRange, setAppliedRange] = useState<DashboardRange>(() => recentDashboardRange(180));
	const [source, setSource] = useState('');
	const [status, setStatus] = useState<DashboardStatus | ''>('');
	const [date, setDate] = useState('');
	const [refresh, setRefresh] = useState(0);
	const [error, setError] = useState(false);
	useEffect(() => {
		setData(undefined); setError(false);
		const receive = (event: MessageEvent) => {
			if (event.data.command === 'dashboard-data') { setData(event.data.data); }
			if (event.data.command === 'dashboard-error') { setError(true); }
			if (event.data.command === 'dashboard-reload') { setRefresh(value => value + 1); }
		};
		window.addEventListener('message', receive);
		const range = period === 'custom' ? appliedRange : period.startsWith('recent') ? recentDashboardRange(Number(period.slice(6))) : undefined;
		vscodeApi.postMessage({ command: 'dashboard-load', range, year: range ? undefined : Number(period), filter: { source: source || undefined, status: status || undefined } });
		return () => window.removeEventListener('message', receive);
	}, [period, source, status, refresh, appliedRange]);
	useEffect(() => { setDate(''); }, [period, source, status, appliedRange]);
	useEffect(() => {
		if (data?.nextRefreshMs === undefined) { return; }
		const timer = window.setTimeout(() => setRefresh(value => value + 1), Math.max(100, data.nextRefreshMs + 50));
		return () => window.clearTimeout(timer);
	}, [data]);
	return <main>
		<header className='dashboard-header'><div className='dashboard-avatar' aria-hidden='true'>✓</div><h1>{t('dashboard')}</h1><p>{t('dashboardPeriodHint')}</p></header>
		<div className='dashboard-controls'>
			<label>{t('dashboardYear')} <select value={period} onChange={event => setPeriod(event.target.value)}>{[30, 90, 180, 365].map(days => <option key={days} value={`recent${days}`}>{t('dashboardRecentDays').replace('{days}', String(days))}</option>)}<option value='custom'>{t('dashboardCustomRange')}</option>{Array.from({ length: Math.max(1, new Date().getFullYear() - 1969) }, (_, index) => new Date().getFullYear() - index).map(year => <option key={year} value={year}>{year}</option>)}</select></label>
			{period === 'custom' && <div className='dashboard-range'>
				<label>{t('dashboardStartDate')} <input type='date' value={customRange.start} onChange={event => setCustomRange(value => ({ ...value, start: event.target.value }))} /></label>
				<label>{t('dashboardEndDate')} <input type='date' value={customRange.end} onChange={event => setCustomRange(value => ({ ...value, end: event.target.value }))} /></label>
				<button disabled={!validDashboardRange(customRange)} onClick={() => setAppliedRange({ ...customRange })}>{t('dashboardApplyRange')}</button>
				{!validDashboardRange(customRange) && <span role='alert'>{t('dashboardInvalidRange')}</span>}
			</div>}
			<label>{t('dashboardSource')} <select value={source} onChange={event => setSource(event.target.value)}><option value=''>{t('dashboardAllSources')}</option>{(data?.sources || (source ? [source] : [])).map(item => <option key={item} value={item}>{label(item)}</option>)}</select></label>
			<label>{t('dashboardAllStates')} <select value={status} onChange={event => setStatus(event.target.value as DashboardStatus | '')}><option value=''>{t('dashboardAllStates')}</option>{(['accepted', 'partial', 'unmarked', 'pending'] as const).map(item => <option key={item} value={item}>{statusLabel(item)}</option>)}</select></label>
			<button onClick={() => setRefresh(value => value + 1)}>{t('dashboardRefresh')}</button>
		</div>
		{error ? <p role='alert'>{t('dashboardError')}</p> : !data ? <p role='status'>{t('dashboardLoading')}</p> : <>
			<DashboardHighlights data={data} />
			{data.skipped > 0 && <p role='status'>{t('dashboardSkipped').replace('{count}', String(data.skipped))}</p>}
			<section className='dashboard-activity'><div className='dashboard-section-heading'><h2>{t('dashboardActivity')}</h2><span>{period === 'custom' ? `${appliedRange.start} \u2013 ${appliedRange.end}` : period.startsWith('recent') ? t('dashboardRecentDays').replace('{days}', period.slice(6)) : period}</span></div>
			<DashboardHeatmap days={data.days} selected={date} onSelect={selected => setDate(value => value === selected ? '' : selected)} />
			</section>
			<DashboardProblemList data={data} date={date} onClear={() => setDate('')} />
		</>}
	</main>;
}
if (typeof document !== 'undefined' && document.getElementById('dashboard')) { createRoot(document.getElementById('dashboard')!).render(<Dashboard />); }
