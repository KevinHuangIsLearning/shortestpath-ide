/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { AbstractSideBySideEditorInputSerializer } from '../../../common/editor/sideBySideEditorInput.js';
import { SourceEditorInput } from '../../../common/editor/sourceEditorInput.js';
import { WebviewInput } from './webviewEditorInput.js';

/** A native source document and its companion webview in one tab. */
export class WebviewSourceEditorInput extends SourceEditorInput {
	static override readonly ID = 'workbench.editorinputs.webviewSource';
	override get typeId(): string { return WebviewSourceEditorInput.ID; }

	protected override createPair(source: EditorInput, ratio: number): WebviewSourceEditorInput {
		return this.instantiationService.createInstance(WebviewSourceEditorInput, this.secondary, source, ratio);
	}
}

export class WebviewSourceEditorInputSerializer extends AbstractSideBySideEditorInputSerializer {
	protected createEditorInput(instantiationService: IInstantiationService, _name: string | undefined, _description: string | undefined, secondary: EditorInput, primary: EditorInput): EditorInput {
		if (!(secondary instanceof WebviewInput)) { throw new Error('Expected a companion webview'); }
		return instantiationService.createInstance(WebviewSourceEditorInput, secondary, primary, undefined);
	}
}
