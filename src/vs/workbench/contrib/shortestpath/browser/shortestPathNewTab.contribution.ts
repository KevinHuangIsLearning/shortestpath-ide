/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { URI } from '../../../../base/common/uri.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { onUnexpectedError } from '../../../../base/common/errors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { EditorExtensions, IEditorCommandsContext, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILifecycleService, LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { ShortestPathNewTabEditor } from './shortestPathNewTabEditor.js';
import { localizeNewTab, ShortestPathNewTabInput } from './shortestPathNewTabInput.js';

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	// allow-any-unicode-next-line
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
		}).catch(onUnexpectedError);
	}
}

// Opening a convenience editor must never be allowed to participate in the
// workbench's blocking startup path. In particular, packaged builds restore
// editor groups after BlockStartup; waiting until that restoration is complete
// also prevents the New Tab from racing the normal editor restoration.
registerWorkbenchContribution2(ShortestPathNewTabStartupContribution.ID, ShortestPathNewTabStartupContribution, WorkbenchPhase.AfterRestored);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'shortestpath.action.openNewTab',
			title: {
				// allow-any-unicode-next-line
				value: localizeNewTab('New Tab', '新建标签页'),
				original: 'New Tab',
			},
			f1: true,
			icon: Codicon.add,
			menu: {
				id: MenuId.EditorTitle,
				group: 'navigation',
				order: -1,
				when: ContextKeyExpr.and(ContextKeyExpr.not('shortestpath.browsing'), ContextKeyExpr.not('shortestpath.page')),
			},
		});
	}

	run(accessor: ServicesAccessor, _resource?: URI, context?: IEditorCommandsContext) {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		return editorService.openEditor(instantiationService.createInstance(ShortestPathNewTabInput), { pinned: true }, context?.groupId);
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
