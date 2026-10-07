/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorsOrder, IEditorIdentifier } from '../../../common/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { AbstractSideBySideEditorInputSerializer } from '../../../common/editor/sideBySideEditorInput.js';
import { SourceEditorInput } from '../../../common/editor/sourceEditorInput.js';
import { BrowserEditorInput } from './browserEditorInput.js';

/** A native source document and its problem page in one tab. */
export class BrowserSourceEditorInput extends SourceEditorInput {
	static override readonly ID = 'workbench.editorinputs.browserSource';
	override get typeId(): string { return BrowserSourceEditorInput.ID; }

	protected override createPair(source: EditorInput, ratio: number): BrowserSourceEditorInput {
		return this.instantiationService.createInstance(BrowserSourceEditorInput, this.secondary, source, ratio);
	}
}

export class BrowserSourceEditorInputSerializer extends AbstractSideBySideEditorInputSerializer {
	protected createEditorInput(instantiationService: IInstantiationService, _name: string | undefined, _description: string | undefined, secondary: EditorInput, primary: EditorInput): EditorInput {
		if (!(secondary instanceof BrowserEditorInput)) { throw new Error('Expected a companion browser'); }
		return instantiationService.createInstance(BrowserSourceEditorInput, secondary, primary, undefined);
	}
}

/** Locate the top-level tab that owns a browser, including a paired problem editor. */
export function findBrowserEditorOwner(editorService: IEditorService, browser: BrowserEditorInput): IEditorIdentifier | undefined {
	return editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).find(({ editor }) =>
		editor === browser || (editor instanceof BrowserSourceEditorInput && editor.secondary === browser));
}
