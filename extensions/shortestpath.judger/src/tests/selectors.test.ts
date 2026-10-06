import { Case, RunResult } from '../types';
import {
    activeTask,
    caseState,
    filterCounts,
    initialFilter,
    matchesFilter,
    summarize,
    verdictOf,
} from '../webview/frontend/selectors';

const run = (overrides: Partial<RunResult>): RunResult => ({
    pass: null,
    id: 1,
    stdout: '',
    stderr: '',
    code: 0,
    signal: null,
    time: 0,
    timeOut: false,
    ...overrides,
});

const item = (id: number, result: RunResult | null, disabled = false): Case => ({
    id,
    result,
    testcase: { id, input: '', output: '', disabled },
});

describe('verdictOf', () => {
    test('prefers the host verdict', () => {
        expect(verdictOf(run({ verdict: 'PE', pass: true }))).toBe('PE');
    });

    test('falls back to execution facts for legacy results', () => {
        expect(verdictOf(run({ timeOut: true }))).toBe('TLE');
        expect(verdictOf(run({ outputLimitExceeded: true }))).toBe('OLE');
        expect(verdictOf(run({ signal: 'SIGSEGV' }))).toBe('RE');
        expect(verdictOf(run({ code: 2 }))).toBe('RE');
        expect(verdictOf(run({ pass: true }))).toBe('AC');
        expect(verdictOf(run({ pass: false }))).toBe('WA');
        expect(verdictOf(null)).toBeUndefined();
    });
});

describe('summarize', () => {
    test('ignores disabled testcases', () => {
        const summary = summarize([item(1, run({ pass: true })), item(2, null), item(3, null, true)]);
        expect(summary).toEqual({ passed: 1, total: 2, pending: 1, failed: 0, empty: false });
    });

    test('an empty problem is not reported as fully passed', () => {
        expect(summarize([]).empty).toBe(true);
        expect(summarize([item(1, null, true)]).empty).toBe(true);
    });
});

describe('filter', () => {
    const cases = [
        item(1, run({ pass: true })),
        item(2, run({ pass: false })),
        item(3, null),
        item(4, null, true),
    ];

    test('counts every filter bucket', () => {
        expect(filterCounts(cases)).toEqual({
            all: 4,
            passed: 1,
            failed: 1,
            pending: 1,
            disabled: 1,
        });
    });

    test('all keeps disabled rows visible', () => {
        expect(cases.filter((value) => matchesFilter(value, 'all'))).toHaveLength(4);
    });

    test('passed and failed exclude disabled rows', () => {
        expect(cases.filter((value) => matchesFilter(value, 'passed')).map((value) => value.id)).toEqual([1]);
        expect(cases.filter((value) => matchesFilter(value, 'failed')).map((value) => value.id)).toEqual([2]);
        expect(cases.filter((value) => matchesFilter(value, 'pending')).map((value) => value.id)).toEqual([3]);
    });

    test('hiddenStatuses only seeds the initial filter', () => {
        expect(initialFilter(undefined)).toBe('all');
        expect(initialFilter([])).toBe('all');
        expect(initialFilter(['AC'])).toBe('failed');
        expect(initialFilter(['WA', 'TLE'])).toBe('passed');
    });
});

describe('caseState', () => {
    test('disabled wins over a stale result', () => {
        expect(caseState(item(1, run({ pass: true }), true), false, false)).toBe('disabled');
    });

    test('running and checking are reported separately', () => {
        expect(caseState(item(1, null), true, false)).toBe('running');
        expect(caseState(item(1, null), false, true)).toBe('checking');
        expect(caseState(item(1, null), false, false)).toBe('pending');
        expect(caseState(item(1, run({ pass: false })), false, false)).toBe('failed');
    });
});

describe('activeTask', () => {
    test('compiling is reported before a run', () => {
        expect(activeTask({ compiling: true, running: true, checking: false, stress: false })).toBe('compiling');
    });

    test('idle when nothing is active', () => {
        expect(activeTask({ compiling: false, running: false, checking: false, stress: false })).toBe('idle');
    });

    test('stress outranks an ordinary run', () => {
        expect(activeTask({ compiling: false, running: true, checking: false, stress: true })).toBe('stress');
    });
});
