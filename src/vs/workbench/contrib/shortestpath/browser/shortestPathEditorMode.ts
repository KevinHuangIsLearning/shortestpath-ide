/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInputCapabilities, IEditorWillOpenEvent } from '../../../common/editor.js';
import { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';

/** Background problem panel updates must not interrupt the current work mode. */
export function shouldRevealSolveEditor(event: IEditorWillOpenEvent): boolean {
	return !event.options?.preserveFocus
		&& !event.options?.inactive
		&& !(event.editor instanceof BrowserEditorInput)
		&& !(event.editor.capabilities & EditorInputCapabilities.RequiresModal);
}
