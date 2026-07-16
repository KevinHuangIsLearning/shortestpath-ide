/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/shortestPathNewTab.css';
import { $, addDisposableListener, append, Dimension } from '../../../../base/browser/dom.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { localizeNewTab } from './shortestPathNewTabInput.js';

export class ShortestPathNewTabEditor extends EditorPane {

	static readonly ID = ShortestPathNewTabEditor.name;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super(ShortestPathNewTabEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected override createEditor(parent: HTMLElement): void {
		const container = append(parent, $('.shortestpath-new-tab'));
		const content = append(container, $('.shortestpath-new-tab-content'));
		append(content, $('h1', undefined, localizeNewTab('shortestPathNewTab.title', 'ShortestPath IDE', 'ShortestPath IDE')));
		append(content, $('.subtitle', undefined, localizeNewTab('shortestPathNewTab.subtitle', 'Competitive programming, focused.', '专注于竞赛编程。')));
		append(content, $('h2', undefined, localizeNewTab('shortestPathNewTab.start', 'Start', '开始')));

		const actions = append(content, $('.shortestpath-new-tab-actions'));
		this.addAction(actions, localizeNewTab('shortestPathNewTab.newFile', 'New File...', '新建文件...'), 'codicon-new-file', () => this.commandService.executeCommand('workbench.action.files.newUntitledFile', { languageId: this.configurationService.getValue<string>('shortestpath.newFile.defaultLanguage') || 'cpp' }));
		this.addAction(actions, localizeNewTab('shortestPathNewTab.open', 'Open...', '打开...'), 'codicon-folder-opened', () => this.commandService.executeCommand('workbench.action.files.openFile'));
		this.addAction(actions, localizeNewTab('shortestPathNewTab.openFolder', 'Open Folder...', '打开文件夹...'), 'codicon-folder', () => this.commandService.executeCommand('workbench.action.files.openFolder'));
		this.addAction(actions, localizeNewTab('shortestPathNewTab.quickOpen', 'Open File Quickly...', '快速打开文件...'), 'codicon-go-to-file', () => this.commandService.executeCommand('workbench.action.quickOpen'));
		this.addAction(actions, localizeNewTab('shortestPathNewTab.browser', 'Open Integrated Browser', '打开内置浏览器'), 'codicon-globe', () => this.commandService.executeCommand('workbench.action.browser.open'));
		this.addAction(actions, localizeNewTab('shortestPathNewTab.settings', 'Open Settings', '打开设置'), 'codicon-settings-gear', () => this.commandService.executeCommand('shortestpath.openSettings'));
	}

	private addAction(parent: HTMLElement, label: string, icon: string, run: () => Thenable<unknown>): void {
		const button = append(parent, $('button.shortestpath-new-tab-action', { type: 'button' }));
		append(button, $(`span.codicon.${icon}`, { 'aria-hidden': 'true' }));
		append(button, $('span', undefined, label));
		this._register(addDisposableListener(button, 'click', () => void run()));
	}

	override focus(): void {
		this.getContainer()?.focus();
	}

	override layout(_dimension: Dimension): void { }
}
