/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ProblemRatingResponse } from './generated/api-contract';

export type Rating = 'good' | 'neutral' | 'bad';

export function isRating(value: unknown): value is Rating {
	return value === 'good' || value === 'neutral' || value === 'bad';
}

export function parseProblemRating(value: unknown): ProblemRatingResponse {
	if (!value || typeof value !== 'object') { throw new Error('评价响应无效。'); }
	const data = value as Partial<ProblemRatingResponse>;
	if (typeof data.can_rate !== 'boolean' || typeof data.rating !== 'string' || (data.rating !== '' && !isRating(data.rating))
		|| !data.counts || ![data.counts.good, data.counts.neutral, data.counts.bad].every(count => Number.isSafeInteger(count) && count >= 0)
		|| (data.first_ac_submission_id !== undefined && (!Number.isSafeInteger(data.first_ac_submission_id) || data.first_ac_submission_id < 0))
		|| (data.unlock_at !== undefined && (typeof data.unlock_at !== 'string' || !Number.isFinite(Date.parse(data.unlock_at))))) {
		throw new Error('评价响应无效。');
	}
	return data as ProblemRatingResponse;
}

/** One account and solve context owns its rating state and first-AC invitation. */
export class ProblemRatingSession {
	data: ProblemRatingResponse | undefined;
	error = '';
	loading = false;
	saving = false;
	promptOpen = false;
	private disposed = false;
	private revision = 0;
	private request: Promise<void> | undefined;
	private unlockTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly submitted = new Set<string>();
	private readonly accepted = new Set<string>();
	private readonly invited = new Set<string>();
	private readonly pendingInvitations = new Set<string>();

	constructor(
		private readonly load: () => Promise<unknown>,
		private readonly save: (rating: Rating) => Promise<unknown>,
		private readonly changed: () => void,
	) { }

	canRate(): boolean {
		return Boolean(this.data && (this.data.can_rate || (this.data.unlock_at && Date.parse(this.data.unlock_at) <= Date.now())));
	}

	refresh(): Promise<void> {
		if (this.disposed) { return Promise.resolve(); }
		if (this.request) { return this.request; }
		const revision = this.revision;
		this.loading = true;
		this.error = '';
		this.changed();
		this.request = (async () => {
			try {
				const data = parseProblemRating(await this.load());
				if (this.disposed || revision !== this.revision) { return; }
				this.data = data;
				if (this.canRate() && this.pendingInvitations.has(String(data.first_ac_submission_id))) { this.promptOpen = true; }
				this.scheduleUnlock();
			} catch (error) {
				if (!this.disposed && revision === this.revision) { this.error = error instanceof Error ? error.message : String(error); }
			} finally {
				this.request = undefined;
				this.loading = false;
				if (!this.disposed) { this.changed(); }
			}
		})();
		return this.request;
	}

	async rate(rating: Rating): Promise<void> {
		if (this.disposed || this.saving || !this.canRate()) { return; }
		this.saving = true;
		this.error = '';
		this.revision++;
		this.changed();
		try {
			const data = parseProblemRating(await this.save(rating));
			if (this.disposed) { return; }
			this.revision++;
			this.data = data;
			this.promptOpen = false;
			this.pendingInvitations.clear();
			this.scheduleUnlock();
		} catch (error) {
			if (!this.disposed) { this.error = error instanceof Error ? error.message : String(error); }
		} finally {
			this.saving = false;
			if (!this.disposed) { this.changed(); }
		}
	}

	trackSubmission(id: string): void {
		this.submitted.add(id);
		if (this.accepted.has(id)) { void this.invite(id); }
	}

	observeAccepted(id: string): void {
		this.accepted.add(id);
		if (this.submitted.has(id)) { void this.invite(id); }
	}

	dismiss(): void {
		this.promptOpen = false;
		this.pendingInvitations.clear();
		this.changed();
	}

	private async invite(id: string): Promise<void> {
		if (this.invited.has(id) || this.disposed) { return; }
		this.invited.add(id);
		this.pendingInvitations.add(id);
		// A pre-AC GET may still be pending; eligibility must come from a fresh response.
		if (this.request) { await this.request; }
		await this.refresh();
	}

	private scheduleUnlock(): void {
		clearTimeout(this.unlockTimer);
		this.unlockTimer = undefined;
		if (!this.data?.can_rate && this.data?.unlock_at) {
			const delay = Date.parse(this.data.unlock_at) - Date.now();
			if (delay > 0) {
				this.unlockTimer = setTimeout(() => {
					this.unlockTimer = undefined;
					if (!this.disposed) { this.scheduleUnlock(); this.changed(); }
				}, Math.min(delay, 2_147_483_647));
			}
		}
	}

	dispose(): void {
		this.disposed = true;
		clearTimeout(this.unlockTimer);
	}
}
