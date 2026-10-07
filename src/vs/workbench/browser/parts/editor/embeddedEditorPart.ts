/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IEmbeddedEditorPart } from '../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IEditorPartsView } from './editor.js';
import { EditorPart } from './editorPart.js';

/** A native editor part hosted inside an existing main-window surface. */
export class EmbeddedEditorPart extends EditorPart implements IEmbeddedEditorPart {
	readonly excludeFromDefaultRouting = true;
	private static counter = 0;
	private readonly scopedServices = this._register(new DisposableStore());
	private editorInstantiationService: IInstantiationService | undefined;

	constructor(
		editorPartsView: IEditorPartsView,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IHostService hostService: IHostService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(editorPartsView, `workbench.parts.embeddedEditor.${EmbeddedEditorPart.counter++}`, '', mainWindow.vscodeWindowId, instantiationService, themeService, configurationService, storageService, layoutService, hostService, contextKeyService);
	}

	override create(parent: HTMLElement): void {
		parent.classList.add('part', 'editor', 'embedded-editor-part');
		super.create(parent, { restorePreviousState: false });
		this.editorInstantiationService = this.scopedServices.add(this.scopedInstantiationService.createChild(new ServiceCollection(
			[IEditorService, this.editorService.createScoped(this, this.scopedServices)]
		)));
	}

	get editorScopedInstantiationService(): IInstantiationService {
		return this.editorInstantiationService ?? this.scopedInstantiationService;
	}

	protected override get useMainWindowFloatingLayout(): boolean { return false; }

	// The owner persists this surface's tabs separately from the solving workspace.
	protected override saveState(): void { }
}
