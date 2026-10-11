/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface SessionPage { readonly id: string; close(): PromiseLike<void> }

/** Keeps the native association page available after load failure or closure. */
export class SessionLinkPage {
	private page?: SessionPage;
	private opening = false;
	private disposed = false;
	private retry?: ReturnType<typeof setTimeout>;
	private health?: ReturnType<typeof setTimeout>;
	private attempt = 0;

	constructor(private readonly url: string, private readonly open: (url: string) => PromiseLike<SessionPage>, private readonly unavailable: () => void, private readonly connected?: () => boolean) { }

	start(): void {
		if (this.disposed || this.opening || this.page) { return; }
		clearTimeout(this.retry);
		this.opening = true;
		void Promise.resolve().then(() => this.open(this.url)).then(page => {
			this.opening = false;
			if (this.disposed) { void page.close(); } else { this.page = page; this.attempt = 0; this.checkHealth(); }
		}, () => {
			this.opening = false;
			this.unavailable();
			this.schedule();
		});
	}

	pageClosed(id: string): void {
		if (this.page?.id !== id) { return; }
		this.page = undefined;
		this.schedule();
	}

	private checkHealth(): void {
		if (!this.connected || this.disposed) { return; }
		clearTimeout(this.health);
		this.health = setTimeout(() => {
			if (!this.connected?.() && this.page) {
				const page = this.page; this.page = undefined;
				void page.close(); this.start();
			} else { this.checkHealth(); }
		}, 30_000);
	}

	private schedule(): void {
		if (this.disposed) { return; }
		this.retry = setTimeout(() => this.start(), Math.min(1000 * 2 ** this.attempt++, 30_000));
	}

	dispose(): void {
		this.disposed = true;
		clearTimeout(this.retry);
		clearTimeout(this.health);
		void this.page?.close();
		this.page = undefined;
	}
}
