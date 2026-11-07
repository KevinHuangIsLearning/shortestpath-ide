/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StressSessionTracker } from '../stressSession';
import { RunResult, TestCase } from '../types';

const result: RunResult = {
    id: 1,
    pass: false,
    verdict: 'WA',
    stdout: 'wrong',
    stderr: '',
    time: 1,
    timeOut: false,
    signal: null,
    code: 0,
};

const testcase: TestCase = { id: 1, input: '1', output: '2' };

test('keeps the latest progress for the problem that owns the run', () => {
    const tracker = new StressSessionTracker();
    tracker.start('/problem/a.cpp', 42, 1000);
    tracker.status('running', 'std', 7, 1000);
    tracker.progress(7, 1000);

    expect(tracker.snapshotFor('/problem/b.cpp')).toBeUndefined();
    expect(tracker.snapshotFor('/problem/a.cpp')).toEqual({
        srcPath: '/problem/a.cpp',
        runId: 42,
        running: true,
        iterations: 1000,
        progress: { iteration: 7, total: 1000 },
        status: { phase: 'running', role: 'std', iteration: 7, total: 1000 },
    });
});

test('keeps the counterexample and the final state after the run ends', () => {
    const tracker = new StressSessionTracker();
    tracker.start('/problem/a.cpp', 42, 1000);
    tracker.progress(3, 1000);
    tracker.failure(3, testcase, result);
    expect(tracker.snapshotFor('/problem/a.cpp')).toMatchObject({
        running: false,
        progress: { iteration: 3, total: 1000 },
        failure: { iteration: 3, testcase, result },
    });

    tracker.finish('found', 3);
    expect(tracker.snapshotFor('/problem/a.cpp')).toMatchObject({
        running: false,
        finished: { state: 'found', iteration: 3 },
        failure: { iteration: 3, testcase, result },
    });
});

test('a new run replaces the previous snapshot', () => {
    const tracker = new StressSessionTracker();
    tracker.start('/problem/a.cpp', 1, 10);
    tracker.finish('passed', 10);
    tracker.start('/problem/b.cpp', 2, 20);

    expect(tracker.snapshotFor('/problem/a.cpp')).toBeUndefined();
    expect(tracker.snapshotFor('/problem/b.cpp')).toMatchObject({
        runId: 2,
        running: true,
        progress: { iteration: 0, total: 20 },
    });
});
