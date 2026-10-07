/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInputCapabilities, IEditorWillOpenEvent } from '../../../common/editor.js';

/** Background problem panel updates must not interrupt the current work mode. */
export function shouldRevealSolveEditor(event: IEditorWillOpenEvent): boolean {
	return !event.options?.preserveFocus
		&& !event.options?.inactive
		&& !(event.editor.capabilities & EditorInputCapabilities.RequiresModal);
}
