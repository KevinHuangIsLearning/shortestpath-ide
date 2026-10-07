/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientMessage, DraftSnapshot } from '../protocol';

export type SaveStatus = 'saved' | 'saving' | 'failed';

/** One trailing save, with explicit flushes for visibility changes and mode transfers. */
export class SaveSession {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private revision = 0;
	private queued: DraftSnapshot | undefined;
	private lastSent: DraftSnapshot | undefined;
	private lastSaved: DraftSnapshot | undefined;
	status: SaveStatus = 'saved';
	onStatus: (status: SaveStatus) => void = () => { };

	constructor(private readonly post: (message: ClientMessage) => void, private readonly delay = 200) { }

	accept(snapshot: DraftSnapshot, notify = true): void {
		this.cancelTimer();
		this.revision++;
		this.queued = undefined;
		this.lastSent = snapshot;
		this.lastSaved = snapshot;
		this.status = 'saved';
		if (notify) { this.onStatus(this.status); }
	}

	change(snapshot: DraftSnapshot): void {
		const previous = this.queued ?? this.lastSent;
		if (previous?.scene === snapshot.scene && previous.library === snapshot.library) { return; }
		this.queued = snapshot;
		this.setStatus('saving');
		// Do not postpone a save forever during a long drag or freehand stroke.
		if (!this.timer) { this.timer = setTimeout(() => this.flush(), this.delay); }
	}

	flush(): void {
		this.cancelTimer();
		if (!this.queued) { return; }
		const snapshot = this.queued;
		this.queued = undefined;
		this.lastSent = snapshot;
		this.post({ type: 'save', snapshot, revision: ++this.revision });
	}

	acknowledge(revision: number, error?: string): void {
		if (revision !== this.revision) { return; }
		if (!error) { this.lastSaved = this.lastSent; }
		this.setStatus(error ? 'failed' : this.queued ? 'saving' : 'saved');
	}

	retry(): void {
		if (!this.queued && this.lastSent !== this.lastSaved) { this.queued = this.lastSent; }
		this.setStatus('saving');
		this.flush();
	}

	dispose(): void { this.flush(); this.onStatus = () => { }; }
	private cancelTimer(): void { if (this.timer) { clearTimeout(this.timer); this.timer = undefined; } }
	private setStatus(status: SaveStatus): void { this.status = status; this.onStatus(status); }
}
