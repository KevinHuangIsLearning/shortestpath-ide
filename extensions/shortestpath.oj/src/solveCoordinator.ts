/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ImportedProblem } from './shortestpathOjProtocol';
import type { WorkspaceProblemRecoveryContext } from './workspaceProblemCache';

export interface SolveDocument {
	readonly sourcePath: string;
	/** The tab instance, not just its path: closing and reopening invalidates pending work. */
	readonly instance: object;
}

export interface SolveContent {
	readonly sourcePath: string;
	readonly context: WorkspaceProblemRecoveryContext;
	readonly problem?: ImportedProblem;
	readonly connected?: boolean;
}

export interface SolveCoordinatorDependencies {
	currentDocument(): SolveDocument | undefined;
	loadSource(sourcePath: string): Promise<SolveContent | undefined>;
	loadUrl(url: string): Promise<SolveContent | undefined>;
	update(content: SolveContent): void;
	select(content: SolveContent): void;
	open(content: SolveContent): Promise<void>;
}

/** Owns selection intent. Data restoration and connection updates never imply navigation. */
export class SolveCoordinator {
	private document?: SolveDocument;
	private revision = 0;
	private request = 0;
	private synchronizedRevision = -1;
	private disposed = false;

	constructor(private readonly deps: SolveCoordinatorDependencies) { }

	private observe(): void {
		const next = this.deps.currentDocument();
		if (next?.instance !== this.document?.instance || next?.sourcePath !== this.document?.sourcePath) {
			this.document = next;
			this.revision++;
		}
	}

	async synchronize(): Promise<void> {
		if (this.disposed) { return; }
		this.observe();
		const document = this.document;
		if (!document || this.synchronizedRevision === this.revision) { return; }
		const revision = this.revision;
		const request = ++this.request;
		const content = await this.deps.loadSource(document.sourcePath);
		this.observe();
		if (this.disposed || revision !== this.revision || request !== this.request || !content) { return; }
		this.synchronizedRevision = revision;
		this.deps.update(content);
		this.deps.select(content);
	}

	/** Invalidate immediately; callers may coalesce expensive synchronization separately. */
	selectionChanged(): void { this.observe(); }

	restore(content: SolveContent): void {
		if (this.disposed) { return; }
		this.deps.update(content);
		this.observe();
		if (this.document?.sourcePath === content.sourcePath) { this.deps.select(content); }
	}

	async openUrl(url: string, expectedSource?: string): Promise<void> {
		if (this.disposed) { return; }
		this.observe();
		if (expectedSource !== undefined) {
			if (this.document?.sourcePath === expectedSource) { await this.synchronize(); }
			return;
		}
		const request = ++this.request;
		const revision = this.revision;
		const content = await this.deps.loadUrl(url);
		this.observe();
		if (this.disposed || request !== this.request || revision !== this.revision || !content) { return; }
		await this.deps.open(content);
	}

	dispose(): void { this.disposed = true; this.request++; }
}
