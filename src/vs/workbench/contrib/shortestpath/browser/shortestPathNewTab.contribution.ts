/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { ShortestPathNewTabEditor } from './shortestPathNewTabEditor.js';
import { localizeNewTab, ShortestPathNewTabInput } from './shortestPathNewTabInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(ShortestPathNewTabEditor, ShortestPathNewTabEditor.ID, localizeNewTab('New Tab', '新建标签页')),
	[new SyncDescriptor(ShortestPathNewTabInput)]
);

class ShortestPathNewTabStartupContribution implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.shortestPathNewTabStartup';

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILifecycleService lifecycleService: ILifecycleService,
	) {
		void lifecycleService.when(LifecyclePhase.Restored).then(() => {
			if (!this.editorService.activeEditor) {
				return this.editorService.openEditor(this.instantiationService.createInstance(ShortestPathNewTabInput));
			}
			return undefined;
		});
	}
}

registerWorkbenchContribution2(ShortestPathNewTabStartupContribution.ID, ShortestPathNewTabStartupContribution, WorkbenchPhase.BlockStartup);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'shortestpath.action.openNewTab',
			title: {
				value: localizeNewTab('New Tab', '新建标签页'),
				original: 'New Tab',
			},
			f1: true,
		});
	}

	run(accessor: ServicesAccessor) {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		return editorService.openEditor(instantiationService.createInstance(ShortestPathNewTabInput));
	}
});

class ShortestPathNewTabInputSerializer implements IEditorSerializer {
	canSerialize(): boolean { return true; }
	serialize(): string { return ''; }
	deserialize(instantiationService: IInstantiationService): ShortestPathNewTabInput {
		return instantiationService.createInstance(ShortestPathNewTabInput);
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(ShortestPathNewTabInput.ID, ShortestPathNewTabInputSerializer);
