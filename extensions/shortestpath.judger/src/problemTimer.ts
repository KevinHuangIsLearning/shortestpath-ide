/*---------------------------------------------------------------------------------------------
 * Copyright (c) 2026 ShortestPath IDE contributors. Licensed under GPL-3.0-or-later.
 *--------------------------------------------------------------------------------------------*/
import { OjTimer, Problem } from './types';

/** Migrate accumulated duration once. A saved timestamp is never advanced on a UI tick. */
export function initializeProblemTimer(problem: Problem, now = Date.now()): Problem {
	if (problem.timeStartedAtUnixMs !== undefined) { return problem; }
	return { ...problem, timeStartedAtUnixMs: now - Math.max(0, problem.timeSpentMs ?? 0) };
}

export function elapsedProblemTime(problem: Problem, now = Date.now()): number {
	if (problem.timeStartedAtUnixMs === undefined) { return Math.max(0, problem.timeSpentMs ?? 0); }
	return Math.max(0, (problem.timeAcceptedAtUnixMs ?? problem.timePartialAcceptedAtUnixMs ?? now) - problem.timeStartedAtUnixMs);
}

/** Completion freezes the clock. Switching status or cancelling preserves the frozen duration. */
export function setProblemCompletion(problem: Problem, completion: 'none' | 'partial' | 'accepted', now = Date.now()): Problem {
	const initialized = initializeProblemTimer(problem, now);
	if (completion === 'accepted' && initialized.timeAcceptedAtUnixMs !== undefined || completion === 'partial' && initialized.timePartialAcceptedAtUnixMs !== undefined && initialized.timeAcceptedAtUnixMs === undefined) {
		return initialized;
	}
	const pausedAt = initialized.timeAcceptedAtUnixMs ?? initialized.timePartialAcceptedAtUnixMs;
	return { ...initialized,
		timeStartedAtUnixMs: initialized.timeStartedAtUnixMs! + (pausedAt === undefined ? 0 : Math.max(0, now - pausedAt)),
		timeAcceptedAtUnixMs: completion === 'accepted' ? now : undefined,
		timePartialAcceptedAtUnixMs: completion === 'partial' ? now : undefined,
	};
}

export function isShortestPathProblem(url: string): boolean {
    try {
        const parsed = new URL(url);
        return parsed.hostname === 'shortestpath.cn' && parsed.pathname.startsWith('/problem/');
    } catch { return false; }
}

/** Use the OJ snapshot and its capture time, including a paused or untimed clock. */
export function elapsedOjTime(timer: OjTimer | undefined, now = Date.now()): number | undefined {
    if (!timer) { return undefined; }
    return Math.max(0, timer.elapsedMs + (timer.mode === 'timed' && timer.running && !timer.accepted ? Math.max(0, now - timer.capturedAtUnixMs) : 0));
}

/** Ignore responses from an old binding/effect or an earlier request. */
export function createOjTimerRequests(srcPath: string, url: string, receive: (timer: OjTimer | undefined) => void, generation = `${Date.now()}-${Math.random()}`) {
    let requested = 0, applied = 0;
    const prefix = `${generation}:`;
    return {
        next: () => `${prefix}${++requested}`,
        apply: (message: { srcPath: string; url: string; requestId: string; timer?: OjTimer }) => {
            if (message.srcPath !== srcPath || message.url !== url || !message.requestId.startsWith(prefix)) { return; }
            const sequence = Number(message.requestId.slice(prefix.length));
            if (!Number.isInteger(sequence) || sequence <= applied || sequence > requested) { return; }
            applied = sequence;
            receive(message.timer);
        },
    };
}
