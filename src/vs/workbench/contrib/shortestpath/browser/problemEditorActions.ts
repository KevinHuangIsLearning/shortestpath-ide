/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { URI } from '../../../../base/common/uri.js';
import { localize2 } from '../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { SideBySideEditor } from '../../../browser/parts/editor/sideBySideEditor.js';
import { IEditorCommandsContext, SideBySideEditor as Side } from '../../../common/editor.js';
import { WebviewSourceEditorInput } from '../../webviewPanel/browser/webviewSourceEditorInput.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

function getEditorPane(accessor: ServicesAccessor, context?: IEditorCommandsContext) {
	return context ? accessor.get(IEditorGroupsService).getGroup(context.groupId)?.activeEditorPane : accessor.get(IEditorService).activeEditorPane;
}

export class RunSourceAction extends Action2 {
	constructor() {
		super({
			id: 'shortestpath.action.runSource',
			title: localize2('sp.runSource', "运行"),
			icon: Codicon.play,
			menu: {
				id: MenuId.EditorTitle,
				group: 'navigation',
				order: 0,
				when: ContextKeyExpr.or(ContextKeyExpr.equals('resourceLangId', 'c'), ContextKeyExpr.equals('resourceLangId', 'cpp'), ContextKeyExpr.equals('resourceLangId', 'cc'))
			}
		});
	}

	override async run(accessor: ServicesAccessor, _resource?: URI, context?: IEditorCommandsContext): Promise<void> {
		const pane = getEditorPane(accessor, context);
		const commandService = accessor.get(ICommandService);
		if (pane instanceof SideBySideEditor && pane.input instanceof WebviewSourceEditorInput) {
			pane.setOptions({ target: Side.PRIMARY });
		}
		pane?.focus();
		await commandService.executeCommand('extension.CompileRun');
	}
}

export class ToggleProblemAreaAction extends Action2 {
	constructor() {
		super({
			id: 'shortestpath.action.toggleProblemArea',
			title: localize2('sp.toggleProblemArea', "收起／展开题目区域"),
			icon: Codicon.layoutSidebarRight,
			menu: {
				id: MenuId.EditorTitle,
				group: 'navigation',
				order: 1,
				when: ContextKeyExpr.equals('activeEditor', 'workbench.editor.webviewSource')
			}
		});
	}

	override run(accessor: ServicesAccessor, _resource?: URI, context?: IEditorCommandsContext): void {
		const pane = getEditorPane(accessor, context);
		if (pane instanceof SideBySideEditor && pane.input instanceof WebviewSourceEditorInput) {
			pane.setSecondaryVisible(!pane.isSecondaryVisible);
		}
	}
}

registerAction2(RunSourceAction);
registerAction2(ToggleProblemAreaAction);
