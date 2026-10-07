/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/shortestPathNewTab.css';
import { $, addDisposableListener, append, Dimension } from '../../../../base/browser/dom.js';
import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { localizeNewTab } from './shortestPathNewTabInput.js';

export class ShortestPathNewTabEditor extends EditorPane {

	// Do not derive this identifier from the class name. Production workbench
	// bundles are minified, where class names are not a stable editor ID.
	static readonly ID = 'workbench.editor.shortestPathNewTab';

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super(ShortestPathNewTabEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		const container = append(parent, $('.shortestpath-new-tab'));
		const content = append(container, $('.shortestpath-new-tab-content'));
		append(content, $('h1', undefined, localizeNewTab('ShortestPath IDE', 'ShortestPath IDE')));
		// allow-any-unicode-next-line
		append(content, $('.subtitle', undefined, localizeNewTab('Choose a problem and start solving.', '选择题目，开始编写与测试。')));

		// Group file actions separately from documentation and support links.
		const columns = append(content, $('.shortestpath-new-tab-columns'));
		// allow-any-unicode-next-line
		const fileActions = this.addColumn(columns, localizeNewTab('Start', '开始'));
		// allow-any-unicode-next-line
		const toolActions = this.addColumn(columns, localizeNewTab('Tools & Resources', '工具与资源'));

		// allow-any-unicode-next-line
		this.addAction(fileActions, localizeNewTab('New File...', '新建文件...'), 'codicon-new-file', () => this.commandService.executeCommand('workbench.action.files.newUntitledFile', { languageId: this.configurationService.getValue<string>('shortestpath.newFile.defaultLanguage') || 'cpp' }));

		// allow-any-unicode-next-line
		this.addAction(fileActions, localizeNewTab('Open...', '打开...'), 'codicon-folder-opened', () => this.commandService.executeCommand('workbench.action.files.openFile'));

		// allow-any-unicode-next-line
		const openFolderAction = this.addAction(fileActions, localizeNewTab('Open Folder...', '打开文件夹...'), 'codicon-folder', () => this.commandService.executeCommand('workbench.action.files.openFolder'));
		const updateFolderAction = () => {
			openFolderAction.hidden = this.workspaceContextService.getWorkspace().folders.length > 0;
		};
		updateFolderAction();
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(updateFolderAction));
		// allow-any-unicode-next-line
		this.addAction(fileActions, localizeNewTab('Open ShortestPath OJ', '打开 ShortestPath OJ'), 'codicon-mortar-board', () => this.commandService.executeCommand('shortestpath.mode.browse'));

		// allow-any-unicode-next-line
		this.addAction(toolActions, localizeNewTab('View Documentation', '查看文档'), 'codicon-book', () => this.openerService.open(URI.parse('https://kevinhuang.feishu.cn/wiki/LLBBwJQQGil2NnkJXWxcAeaLndd'), { openExternal: true }));

		// allow-any-unicode-next-line
		this.addAction(toolActions, localizeNewTab('Buy Me a Coffee', '请我喝杯咖啡'), 'codicon-coffee', () => this.commandService.executeCommand('workbench.action.browser.open', 'https://kevinhuang.feishu.cn/wiki/Z6a6w3M9riOFXXkXLAoc1G7inJd'));

		// allow-any-unicode-next-line
		this.addAction(toolActions, localizeNewTab('Beware of telecom fraud, do not click!!!', '谨防电信诈骗，千万别点！！！'), 'codicon-warning', () => this.commandService.executeCommand('workbench.action.browser.open', localizeNewTab('https://youtu.be/dQw4w9WgXcQ?si=SnNrGNt_WDv4861J', 'https://player.bilibili.com/player.html?isOutside=true&aid=80433022&bvid=BV1GJ411x7h7&cid=137649199&p=1')));
	}

	private addColumn(parent: HTMLElement, title: string): HTMLElement {
		const column = append(parent, $('section.shortestpath-new-tab-column'));
		append(column, $('h2', undefined, title));
		return append(column, $('.shortestpath-new-tab-actions'));
	}

	private addAction(parent: HTMLElement, label: string, icon: string, run: () => Thenable<unknown>): HTMLElement {
		const button = append(parent, $('button.shortestpath-new-tab-action', { type: 'button' }));
		append(button, $(`span.codicon.${icon}`, { 'aria-hidden': 'true' }));
		append(button, $('span', undefined, label));
		this._register(addDisposableListener(button, 'click', () => void run()));
		return button;
	}

	override focus(): void {
		this.getContainer()?.focus();
	}

	override layout(_dimension: Dimension): void { }
}
