/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import { Case, RunResult } from '../../types';

export type Verdict = NonNullable<RunResult['verdict']>;

/** State rendered by the testcase card header. */
export type CaseState =
    | 'pending'
    | 'running'
    | 'checking'
    | 'passed'
    | 'failed'
    | 'skipped'
    | 'disabled';

/**
 * Displayed verdict for a run result. Older cached results may predate the
 * `verdict` field, so fall back to the execution facts in a fixed order instead
 * of inventing a new judging rule.
 */
export function verdictOf(result: RunResult | null | undefined): Verdict | undefined {
    if (!result) { return undefined; }
    if (result.verdict) { return result.verdict; }
    if (result.timeOut) { return 'TLE'; }
    if (result.outputLimitExceeded) { return 'OLE'; }
    if (result.signal) { return 'RE'; }
    if (result.code !== null && result.code !== undefined && result.code !== 0) { return 'RE'; }
    if (result.pass === true) { return 'AC'; }
    if (result.pass === false) { return 'WA'; }
    return undefined;
}

export type StatusFilter = 'all' | 'passed' | 'failed' | 'pending' | 'disabled';

export const STATUS_FILTERS: StatusFilter[] = ['all', 'passed', 'failed', 'pending', 'disabled'];

export const FILTER_LABEL_KEYS: Record<StatusFilter, string> = {
    all: 'filterAll',
    passed: 'filterPassed',
    failed: 'filterFailed',
    pending: 'filterPending',
    disabled: 'disabled',
};

/**
 * Session filter a panel starts with. The global `hiddenStatuses` preference is
 * only read as an initial value; changing the filter never writes it back.
 */
export function initialFilter(hiddenStatuses?: string[]): StatusFilter {
    const hidden = hiddenStatuses || [];
    if (hidden.includes('AC')) { return 'failed'; }
    if (hidden.length) { return 'passed'; }
    return 'all';
}

export function matchesFilter(item: Case, filter: StatusFilter): boolean {
    if (filter === 'all') { return true; }
    if (filter === 'disabled') { return item.testcase.disabled === true; }
    if (item.testcase.disabled) { return false; }
    if (filter === 'pending') { return item.result === null; }
    const passed = item.result?.pass === true;
    return filter === 'passed' ? passed : item.result !== null && !passed;
}

export function filterCounts(cases: Case[]): Record<StatusFilter, number> {
    return STATUS_FILTERS.reduce((counts, filter) => {
        counts[filter] = cases.filter((item) => matchesFilter(item, filter)).length;
        return counts;
    }, {} as Record<StatusFilter, number>);
}

export function caseState(
    item: Case,
    running: boolean,
    checking: boolean,
): CaseState {
    if (item.testcase.disabled) { return 'disabled'; }
    if (running) { return 'running'; }
    if (checking) { return 'checking'; }
    if (!item.result) { return 'pending'; }
    return item.result.pass === true ? 'passed' : 'failed';
}

export type Summary = {
    passed: number;
    total: number;
    pending: number;
    failed: number;
    empty: boolean;
};

/** Whole-problem counters. Filtering the list must never change these. */
export function summarize(cases: Case[]): Summary {
    const enabled = cases.filter((item) => !item.testcase.disabled);
    const passed = enabled.filter((item) => item.result?.pass === true).length;
    const pending = enabled.filter((item) => item.result === null).length;
    return {
        passed,
        total: enabled.length,
        pending,
        failed: enabled.length - passed - pending,
        empty: enabled.length === 0,
    };
}

export function formatDuration(ms: number): string {
    const totalSeconds = Math.floor((ms || 0) / 1000);
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export type TaskKind =
    | 'idle'
    | 'compiling'
    | 'running'
    | 'checking'
    | 'stress';

export type RunFlags = {
    compiling: boolean;
    running: boolean;
    checking: boolean;
    stress: boolean;
};

/** One primary task for the status bar, most blocking first. */
export function activeTask(flags: RunFlags): TaskKind {
    if (flags.compiling) { return 'compiling'; }
    if (flags.stress) { return 'stress'; }
    if (flags.running) { return 'running'; }
    if (flags.checking) { return 'checking'; }
    return 'idle';
}

export function progressPercent(value: number, total: number): number {
    return Math.min(100, (value / Math.max(1, total)) * 100);
}

export function truncatePreview(text: string, limit = 100000): { text: string; truncated: boolean } {
    if (text.length <= limit) { return { text, truncated: false }; }
    return { text: text.slice(0, limit), truncated: true };
}
