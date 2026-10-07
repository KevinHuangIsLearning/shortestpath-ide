/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ThemeRegistration } from 'shiki';

/** Keeps asynchronous theme reads from applying an older theme after a newer selection. */
export class EditorCodeTheme {
	private theme: ThemeRegistration | undefined;
	private revision = 0;
	private disposed = false;

	constructor(
		private readonly load: () => PromiseLike<ThemeRegistration | undefined>,
		private readonly fallback: () => string,
		private readonly changed: () => void,
	) { }

	get value(): string | ThemeRegistration {
		return this.theme ?? this.fallback();
	}

	async refresh(): Promise<void> {
		const revision = ++this.revision;
		let theme: ThemeRegistration | undefined;
		try {
			theme = await this.load();
		} catch {
			// Older hosts without the command still support the bundled light/dark themes.
		}
		if (this.disposed || revision !== this.revision) { return; }
		this.theme = theme;
		this.changed();
	}

	dispose(): void {
		this.disposed = true;
	}
}
