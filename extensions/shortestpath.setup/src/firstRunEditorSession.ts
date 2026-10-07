/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type FirstRunPage = 'compile' | 'editor' | 'template' | 'workspace';

/** Keep page transitions, queued saves, and completion consistent across reopening. */
export class FirstRunEditorSession {
	page: FirstRunPage = 'compile';
	workspaceFolder: string | undefined;
	finishing = false;
	choosingWorkspace = false;
	private saves: Promise<void> = Promise.resolve();

	async flush(): Promise<void> { await this.saves; }

	async enter(page: FirstRunPage, ready: boolean): Promise<boolean> {
		if (this.finishing || this.choosingWorkspace || (page !== 'compile' && !ready)) { return false; }
		await this.saves;
		if (this.finishing || this.choosingWorkspace) { return false; }
		this.page = page;
		return true;
	}

	save(operation: () => Promise<void>, page: 'editor' | 'template' = 'editor'): boolean {
		if (this.finishing || this.page !== page) { return false; }
		// Save callbacks report errors; completion reapplies the final settings.
		this.saves = this.saves.then(operation).catch(() => undefined);
		return true;
	}

	async complete(ready: boolean, operation: () => Promise<void>): Promise<boolean> {
		if (this.finishing || this.choosingWorkspace || this.page !== 'workspace' || !this.workspaceFolder || !ready) { return false; }
		this.finishing = true;
		try {
			await this.saves;
			await operation();
			return true;
		} finally {
			this.finishing = false;
		}
	}
}
