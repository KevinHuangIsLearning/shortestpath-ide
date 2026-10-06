/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';
import { GroupIdentifier, ISaveOptions, IUntypedEditorInput, Verbosity, IMoveResult } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { AbstractSideBySideEditorInputSerializer, SideBySideEditorInput } from '../../../common/editor/sideBySideEditorInput.js';
import { ITextEditorService } from '../../../services/textfile/common/textEditorService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { WebviewInput } from './webviewEditorInput.js';

/** A source document and its companion webview, with one tab and native save/close semantics. */
export class WebviewSourceEditorInput extends SideBySideEditorInput {
	static override readonly ID = 'workbench.editorinputs.webviewSource';
	override get typeId(): string { return WebviewSourceEditorInput.ID; }
	override get resource(): URI | undefined { return this.primary.resource; }
	override get primaryOnLeft(): boolean { return true; }
	override get viewStateResource(): URI | undefined { return this.primary.resource; }
	override get allowEmptySecondaryViewState(): boolean { return true; }
	override get forceHorizontalLayout(): boolean { return true; }
	override get revealOnPrimaryOpen(): boolean { return true; }
	override get initialSplitRatio(): number { return this.ratio; }

	private readonly ratio: number;

	constructor(
		webview: WebviewInput,
		source: EditorInput,
		sourceRatio: number | undefined,
		@IEditorService sourceEditorService: IEditorService,
		@ITextEditorService private readonly textEditorService: ITextEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(undefined, undefined, webview, source, sourceEditorService);
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
		return this.instantiationService.createInstance(WebviewSourceEditorInput, this.secondary as WebviewInput, source, this.ratio * 100);
	}

	override async rename(group: GroupIdentifier, target: URI): Promise<IMoveResult | undefined> {
		const result = await this.primary.rename(group, target);
		if (!result) { return undefined; }
		const editor = await this.preservePair(result.editor);
		if (!editor) { return undefined; }
		return { editor, options: result.options };
	}
}

export class WebviewSourceEditorInputSerializer extends AbstractSideBySideEditorInputSerializer {
	protected createEditorInput(instantiationService: IInstantiationService, _name: string | undefined, _description: string | undefined, secondary: EditorInput, primary: EditorInput): EditorInput {
		if (!(secondary instanceof WebviewInput)) { throw new Error('Expected a companion webview'); }
		return instantiationService.createInstance(WebviewSourceEditorInput, secondary, primary, undefined);
	}
}
