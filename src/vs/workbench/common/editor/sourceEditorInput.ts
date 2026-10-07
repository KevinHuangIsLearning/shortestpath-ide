/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../base/common/uri.js';
import { GroupIdentifier, ISaveOptions, IUntypedEditorInput, Verbosity, IMoveResult } from '../editor.js';
import { EditorInput } from './editorInput.js';
import { SideBySideEditorInput } from './sideBySideEditorInput.js';
import { ITextEditorService } from '../../services/textfile/common/textEditorService.js';
import { IEditorService } from '../../services/editor/common/editorService.js';

/** A source document and its companion pane, with one tab and native save/close semantics. */
export abstract class SourceEditorInput extends SideBySideEditorInput {
	override get resource(): URI | undefined { return this.primary.resource; }
	override get primaryOnLeft(): boolean { return true; }
	override get viewStateResource(): URI | undefined { return this.primary.resource; }
	override get allowEmptySecondaryViewState(): boolean { return true; }
	override get forceHorizontalLayout(): boolean { return true; }
	override get revealOnPrimaryOpen(): boolean { return true; }
	override get initialSplitRatio(): number { return this.ratio; }

	private readonly ratio: number;

	constructor(
		companion: EditorInput,
		source: EditorInput,
		sourceRatio: number | undefined,
		@IEditorService sourceEditorService: IEditorService,
		@ITextEditorService private readonly textEditorService: ITextEditorService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
	) {
		super(undefined, undefined, companion, source, sourceEditorService);
		this.ratio = typeof sourceRatio === 'number' && Number.isFinite(sourceRatio) ? Math.min(90, Math.max(10, sourceRatio)) / 100 : 0.6;
	}

	override getName(): string { return this.primary.getName(); }
	override getTitle(verbosity?: Verbosity): string { return this.primary.getTitle(verbosity); }
	override getDescription(verbosity?: Verbosity): string | undefined { return this.primary.getDescription(verbosity); }
	override getIcon() { return this.primary.getIcon(); }
	override toUntyped(): undefined { return undefined; }

	override async save(group: GroupIdentifier, options?: ISaveOptions): Promise<EditorInput | IUntypedEditorInput | undefined> {
		const result = await this.primary.save(group, options);
		return this.preservePair(result);
	}

	override async saveAs(group: GroupIdentifier, options?: ISaveOptions): Promise<EditorInput | IUntypedEditorInput | undefined> {
		const result = await this.primary.saveAs(group, options);
		return this.preservePair(result);
	}

	private async preservePair(result: EditorInput | IUntypedEditorInput | undefined): Promise<EditorInput | undefined> {
		if (!result) { return undefined; }
		if (this.primary.matches(result)) { return this; }
		const source = result instanceof EditorInput ? result : await this.textEditorService.resolveTextEditor(result);
		return this.createPair(source, this.ratio * 100);
	}

	protected abstract createPair(source: EditorInput, ratio: number): SourceEditorInput;

	override async rename(group: GroupIdentifier, target: URI): Promise<IMoveResult | undefined> {
		const result = await this.primary.rename(group, target);
		if (!result) { return undefined; }
		const editor = await this.preservePair(result.editor);
		if (!editor) { return undefined; }
		return { editor, options: result.options };
	}
}
