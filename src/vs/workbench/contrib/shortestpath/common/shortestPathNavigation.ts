/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Tracks actual navigation, including leaving a surface and later returning to it. */
export class ShortestPathNavigation {
	private mode?: string;
	private editor?: object;
	private group?: number;
	private revision = 0;

	observe(mode: string, editor: object | undefined, group: number): number {
		if (mode !== this.mode || editor !== this.editor || group !== this.group) {
			this.mode = mode;
			this.editor = editor;
			this.group = group;
			this.revision++;
		}
		return this.revision;
	}
}
