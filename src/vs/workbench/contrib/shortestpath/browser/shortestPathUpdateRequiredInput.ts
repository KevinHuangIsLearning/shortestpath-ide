/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { ConfirmResult } from '../../../../platform/dialogs/common/dialogs.js';
import { EditorInput, IEditorCloseHandler } from '../../../common/editor/editorInput.js';

export class ShortestPathUpdateRequiredInput extends EditorInput implements IEditorCloseHandler {

	static readonly ID = 'workbench.editor.shortestPathUpdateRequired';
	static readonly RESOURCE = URI.from({ scheme: 'shortestpath-update-required', path: 'default' });
	override readonly closeHandler = this;

	constructor(
		readonly minimumSupportedVersion: string,
		readonly downloadUrl: string,
	) {
		super();
	}

	override get typeId(): string { return ShortestPathUpdateRequiredInput.ID; }
	override get editorId(): string { return ShortestPathUpdateRequiredInput.ID; }
	override get capabilities(): EditorInputCapabilities { return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton | EditorInputCapabilities.NoNewWindow | EditorInputCapabilities.ExcludeFromEditorLimit; }
	override get resource(): URI { return ShortestPathUpdateRequiredInput.RESOURCE; }

	override getName(): string {
		// allow-any-unicode-next-line
		return '需要升级';
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(other) || other instanceof ShortestPathUpdateRequiredInput;
	}

	showConfirm(): boolean {
		return true;
	}

	confirm(): Promise<ConfirmResult> {
		return Promise.resolve(ConfirmResult.CANCEL);
	}
}
