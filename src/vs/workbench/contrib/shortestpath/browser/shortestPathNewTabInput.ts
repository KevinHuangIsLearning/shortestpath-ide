/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInput } from '../../../common/editor/editorInput.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { URI } from '../../../../base/common/uri.js';
import { getNLSLanguage } from '../../../../nls.js';

export function localizeNewTab(english: string, chinese: string): string {
	return getNLSLanguage()?.toLowerCase().startsWith('zh') ? chinese : english;
}

export class ShortestPathNewTabInput extends EditorInput {

	static readonly ID = 'workbench.editor.shortestPathNewTab';
	static readonly RESOURCE = URI.from({ scheme: 'shortestpath-new-tab', path: 'default' });

	override get typeId(): string { return ShortestPathNewTabInput.ID; }
	override get editorId(): string { return ShortestPathNewTabInput.ID; }
	override get capabilities(): EditorInputCapabilities { return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton; }
	override get resource(): URI { return ShortestPathNewTabInput.RESOURCE; }

	override getName(): string {
		return localizeNewTab('New Tab', '新建标签页');
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(other) || other instanceof ShortestPathNewTabInput;
	}
}
