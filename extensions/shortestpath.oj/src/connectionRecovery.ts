/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WorkspaceProblemRecoveryContext } from './workspaceProblemCache';
import type { IdeRecoveryStatus } from './generated/ide-bridge-contract';

export type RecoveryState = IdeRecoveryStatus | 'connected';
export interface RecoveryPage {
	readonly id: string;
	close(): PromiseLike<void>;
	show(): PromiseLike<void>;
}
export interface RecoveryDependencies {
	open(url: string): PromiseLike<RecoveryPage>;
	prepare(problem: WorkspaceProblemRecoveryContext): string;
	cancel(): void;
	isBound(problemRef: string): boolean;
	status(problemRef: string, state: RecoveryState): void;
	returnToSolve?(): PromiseLike<void>;
}

export function recoveryIdentity(problem: WorkspaceProblemRecoveryContext): string {
	return JSON.stringify([new URL(problem.url).origin, problem.accountId, problem.target ?? problem.ref]);
}

/** Owns one background website connection for the selected problem. */
export class ConnectionRecovery {
	private problem: WorkspaceProblemRecoveryContext | undefined;
	private page: RecoveryPage | undefined;
	private generation = 0;
	private opening = false;
	private disposed = false;
	private shown = false;
	private showWhenReady = false;
	private blocked = false;
	private attempt = 0;
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(private readonly deps: RecoveryDependencies, private readonly deadlineMs = 30_000, private readonly retryUnitMs = 1000) { }

	select(problem: WorkspaceProblemRecoveryContext): void {
		if (this.disposed) { return; }
		if (!this.problem || recoveryIdentity(this.problem) !== recoveryIdentity(problem)) {
			this.stop();
			this.problem = problem;
		}
		if (this.deps.isBound(problem.ref) || this.blocked || this.opening) { return; }
		if (!this.page) { void this.open(); }
		else { this.watchdog(); }
	}

	private clearTimer(): void { clearTimeout(this.timer); this.timer = undefined; }

	private watchdog(): void {
		if (this.timer || !this.problem || this.blocked || this.shown) { return; }
		this.timer = setTimeout(() => {
			this.timer = undefined;
			if (this.problem && !this.deps.isBound(this.problem.ref)) {
				this.deps.status(this.problem.ref, 'error');
				this.retryLater();
			}
		}, this.deadlineMs);
	}

	private async open(): Promise<void> {
		const problem = this.problem;
		if (!problem || this.disposed || this.opening) { return; }
		this.opening = true;
		const generation = this.generation;
		this.deps.status(problem.ref, 'connecting');
		try {
			const token = this.deps.prepare(problem);
			const url = new URL('/ide/connect', problem.url);
			url.searchParams.set('token', token);
			const page = await this.deps.open(url.href);
			if (this.disposed || generation !== this.generation) { await page.close(); return; }
			this.page = page;
			if (this.showWhenReady) {
				this.showWhenReady = false;
				this.shown = true;
				await page.show();
			}
			this.watchdog();
		} catch {
			if (generation === this.generation && !this.disposed) {
				this.deps.status(problem.ref, 'error');
				this.retryLater();
			}
		} finally {
			if (generation === this.generation) { this.opening = false; }
		}
	}

	private retryLater(): void {
		this.clearTimer();
		this.timer = setTimeout(() => { this.timer = undefined; void this.replace(); }, Math.min(this.retryUnitMs * 2 ** this.attempt++, 8000));
	}

	private async replace(): Promise<void> {
		this.clearTimer();
		const page = this.page;
		this.page = undefined;
		this.shown = false;
		const generation = ++this.generation;
		this.opening = true;
		this.deps.cancel();
		try { await page?.close(); } catch { /* A destroyed browser is already closed. */ }
		if (generation !== this.generation || this.disposed) { return; }
		this.opening = false;
		await this.open();
	}

	websiteStatus(problemRef: string, state: IdeRecoveryStatus): void {
		if (this.disposed || this.problem?.ref !== problemRef) { return; }
		const wasBlocked = this.blocked;
		this.blocked = state === 'login_required' || state === 'account_mismatch' || state === 'verification_required';
		if (state === 'connecting' && this.deps.isBound(problemRef)) {
			this.connected(this.problem, true);
			return;
		}
		this.deps.status(problemRef, state);
		if (this.blocked) {
			this.clearTimer();
			if (!wasBlocked && !this.shown && !this.showWhenReady) {
				void this.login().catch(error => console.warn('Failed to show ShortestPath recovery page.', error));
			}
		} else { this.watchdog(); }
	}

	connected(problem: WorkspaceProblemRecoveryContext, resumed: boolean): void {
		if (this.disposed) { return; }
		if (!resumed) { this.stop(); this.problem = problem; }
		else if (!this.problem || recoveryIdentity(this.problem) !== recoveryIdentity(problem)) { return; }
		this.clearTimer();
		this.blocked = false;
		this.showWhenReady = false;
		this.attempt = 0;
		this.deps.status(problem.ref, 'connected');
		// Keep the authenticated relay: recreating it repeats protected reads and
		// can challenge the user again immediately after successful verification.
		if (resumed && this.shown) {
			this.shown = false;
			void this.deps.returnToSolve?.();
		}
	}

	async login(): Promise<void> {
		this.clearTimer();
		if (!this.page) {
			this.showWhenReady = true;
			await this.open();
		} else { this.shown = true; await this.page.show(); }
	}

	retry(): void {
		this.blocked = false;
		this.attempt = 0;
		void this.replace();
	}

	pageClosed(id: string): void {
		if (this.page?.id !== id || this.disposed) { return; }
		this.page = undefined;
		this.shown = false;
		if (!this.blocked) { this.retryLater(); }
	}

	stop(problemRef?: string): void {
		if (problemRef && this.problem?.ref !== problemRef) { return; }
		this.clearTimer();
		this.generation++;
		this.opening = false;
		this.blocked = false;
		this.shown = false;
		this.showWhenReady = false;
		this.attempt = 0;
		this.problem = undefined;
		this.deps.cancel();
		const page = this.page;
		this.page = undefined;
		if (page) { void Promise.resolve(page.close()).catch(() => {}); }
	}

	dispose(): void { this.disposed = true; this.stop(); }
}
