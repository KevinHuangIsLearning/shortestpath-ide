import { terminateProcess } from './processTermination';
import { runningBinaries } from './executions';
import { runningCompilers } from './compiler';

// Ordinary runs are sequential. A testcase stop does not cancel the remaining queue.
let active: { source: string; id: number; stopped: boolean } | undefined;
export function beginTestcase(source: string, id: number) {
    const state = { source, id, stopped: false };
    active = state;
    return {
        stopped: () => state.stopped,
        dispose: () => { if (active === state) { active = undefined; } },
    };
}
export function stopTestcase(source: string, id: number): void {
    if (!active || active.source !== source || active.id !== id) { return; }
    active.stopped = true;
    for (const child of [...runningBinaries, ...runningCompilers]) { terminateProcess(child); }
}
