/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { localizeNewTab } from '../../../shortestpath/browser/shortestPathNewTabInput.js';
import { BrowserEditorInput } from '../../common/browserEditorInput.js';
import { IBrowserViewModel } from '../../common/browserView.js';
import { BROWSER_EDITOR_ACTIVE, BrowserActionGroup, BrowserEditor, BrowserEditorContribution } from '../browserEditor.js';

const canImportContext = new RawContextKey<boolean>('shortestpath.browserCanImportProblem', false);
const importingContext = new RawContextKey<boolean>('shortestpath.browserImportingProblem', false);

export function canImportBrowserProblem(url: string | undefined): boolean {
	try {
		const parsed = new URL(url ?? '');
		return /^https?:$/.test(parsed.protocol) && !['shortestpath.cn', 'www.shortestpath.cn'].includes(parsed.hostname);
	} catch { return false; }
}

/** Native toolbar entry; the extension owns parser selection and file creation. */
export class BrowserProblemImportFeature extends BrowserEditorContribution {
	private readonly canImport: IContextKey<boolean>;
	private readonly importing: IContextKey<boolean>;
	private busy = false;

	constructor(
		editor: BrowserEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService private readonly commands: ICommandService,
		@INotificationService private readonly notifications: INotificationService,
	) {
		super(editor);
		this.canImport = canImportContext.bindTo(contextKeyService);
		this.importing = importingContext.bindTo(contextKeyService);
	}

	override prerenderInput(input: BrowserEditorInput): void { this.canImport.set(canImportBrowserProblem(input.url)); }

	protected override onModelAttached(model: IBrowserViewModel, store: DisposableStore): void {
		this.canImport.set(canImportBrowserProblem(model.url));
		store.add(model.onDidNavigate(event => this.canImport.set(canImportBrowserProblem(event.url))));
	}

	override onModelDetached(): void { this.canImport.reset(); }

	async importProblem(): Promise<void> {
		const input = this.editor.input;
		if (this.busy || !(input instanceof BrowserEditorInput) || !canImportBrowserProblem(input.url)) { return; }
		this.busy = true;
		this.importing.set(true);
		try {
			const result = await this.commands.executeCommand<{ count: number; error?: string; cancelled?: boolean }>('judger.importBrowserProblem', input.id, undefined, input.url);
			if (result?.error) { this.notifications.error(result.error); }
		} catch (error) {
			this.notifications.error(error instanceof Error ? error : String(error));
		} finally {
			this.busy = false;
			this.importing.reset();
		}
	}
}

BrowserEditor.registerContribution(BrowserProblemImportFeature);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'shortestpath.browser.importProblem',
			title: { value: localizeNewTab('Import Problem', '导入题目'), original: 'Import Problem' },
			icon: Codicon.cloudDownload,
			precondition: ContextKeyExpr.and(BROWSER_EDITOR_ACTIVE, canImportContext, importingContext.negate()),
			menu: { id: MenuId.BrowserActionsToolbar, group: BrowserActionGroup.Tabs, order: 0, when: canImportContext },
		});
	}

	async run(accessor: ServicesAccessor, editor = accessor.get(IEditorService).activeEditorPane): Promise<void> {
		if (editor instanceof BrowserEditor) { await editor.getContribution(BrowserProblemImportFeature)?.importProblem(); }
	}
});
