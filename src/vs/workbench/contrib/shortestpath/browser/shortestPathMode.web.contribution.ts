/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { BrowserEditorInput } from '../../browserView/common/browserEditorInput.js';
import { IShortestPathModeService } from '../common/shortestPathMode.js';

/** The web workbench still constructs the browser API customer, but has no native browser. */
class WebShortestPathModeService implements IShortestPathModeService {
	declare readonly _serviceBrand: undefined;
	readonly mode = 'solve';
	readonly activeBrowser = undefined;
	readonly onDidChangeActiveBrowser = Event.None;
	async switchMode(): Promise<void> { }
	async openBrowser(): Promise<BrowserEditorInput> { throw new Error('Integrated Browser is not available in web.'); }
	async showBrowser(): Promise<void> { throw new Error('Integrated Browser is not available in web.'); }
	notifyResult(): void { }
}

registerSingleton(IShortestPathModeService, WebShortestPathModeService, InstantiationType.Delayed);
