/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    RunResult,
    StressProgramRole,
    StressSessionState,
    TestCase,
} from './types';

/**
 * Keeps the last stress-test snapshot in the extension host. Closing the dialog
 * does not stop the run, and a webview that is destroyed and recreated (for
 * example after switching problems or hiding the sidebar) can ask for this
 * snapshot and show the same progress again.
 */
export class StressSessionTracker {
    private current: StressSessionState | undefined;

    public start(
        srcPath: string,
        runId: number,
        iterations: number,
    ): void {
        this.current = {
            srcPath,
            runId,
            running: true,
            iterations,
            progress: { iteration: 0, total: iterations },
        };
    }

    public status(
        phase: 'compiling' | 'running',
        role?: StressProgramRole | 'target',
        iteration?: number,
        total?: number,
    ): void {
        if (!this.current) { return; }
        this.current.status = { phase, role, iteration, total };
    }

    public progress(iteration: number, total: number): void {
        if (!this.current) { return; }
        this.current.progress = { iteration, total };
    }

    public failure(
        iteration: number,
        testcase: TestCase,
        result: RunResult,
    ): void {
        if (!this.current) { return; }
        this.current.running = false;
        this.current.failure = { iteration, testcase, result };
    }

    public finish(
        state: 'passed' | 'found' | 'stopped' | 'error',
        iteration: number,
        message?: string,
    ): void {
        if (!this.current) { return; }
        this.current.running = false;
        this.current.finished = { state, iteration, message };
    }

    /** Only hand a run back to the problem it belongs to. */
    public snapshotFor(srcPath: string): StressSessionState | undefined {
        return this.current?.srcPath === srcPath ? this.current : undefined;
    }
}
