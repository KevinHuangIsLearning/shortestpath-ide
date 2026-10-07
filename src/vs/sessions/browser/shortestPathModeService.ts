/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../base/common/event.js';
import { BrowserViewStorageScope } from '../../platform/browserView/common/browserView.js';
import { InstantiationType, registerSingleton } from '../../platform/instantiation/common/extensions.js';
import { BrowserEditorInput } from '../../workbench/contrib/browserView/common/browserEditorInput.js';
import { IBrowserViewWorkbenchService } from '../../workbench/contrib/browserView/common/browserView.js';
import { IShortestPathModeService } from '../../workbench/contrib/shortestpath/common/shortestPathMode.js';
import { IEditorService } from '../../workbench/services/editor/common/editorService.js';

/** Keeps browser API customers available without adding IDE navigation to Sessions. */
class SessionsShortestPathModeService implements IShortestPathModeService {
	declare readonly _serviceBrand: undefined;
	readonly mode = 'solve';
	readonly activeBrowser = undefined;
	readonly onDidChangeActiveBrowser = Event.None;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IBrowserViewWorkbenchService private readonly browserViewService: IBrowserViewWorkbenchService,
	) { }

	ownsBrowserTab(): boolean { return false; }
	async switchMode(): Promise<void> { }
	notifyResult(): void { }

	async openBrowser(url?: string, _newTab?: boolean, preserveFocus?: boolean): Promise<BrowserEditorInput> {
		const input = await this.browserViewService.createBrowserView({ owner: { type: 'user' }, session: { scope: BrowserViewStorageScope.Global } });
		try {
			if (url) {
				const model = await input.resolve();
				await model.loadURL(url);
			}
			await this.showBrowser(input, preserveFocus);
			return input;
		} catch (error) {
			input.dispose();
			throw error;
		}
	}

	async showBrowser(input: BrowserEditorInput, preserveFocus?: boolean): Promise<void> {
		await this.editorService.openEditor(input, { pinned: true, preserveFocus }, await this.browserViewService.getPreferredGroup());
	}
}

registerSingleton(IShortestPathModeService, SessionsShortestPathModeService, InstantiationType.Delayed);
