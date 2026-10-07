/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter, Event } from '../../../../base/common/event.js';
import { mock } from '../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IEditorPane } from '../../../common/editor.js';
import { IEditorService, SIDE_GROUP } from '../../../services/editor/common/editorService.js';
import { workbenchInstantiationService } from '../../../test/browser/workbenchTestServices.js';
import { BrowserEditorInput } from '../../../contrib/browserView/common/browserEditorInput.js';
import { IBrowserViewWorkbenchService } from '../../../contrib/browserView/common/browserView.js';
import { IShortestPathModeService, ShortestPathMode } from '../../../contrib/shortestpath/common/shortestPathMode.js';
import { MainThreadBrowsers } from '../../browser/mainThreadBrowsers.js';
import { ExtHostBrowsersShape } from '../../common/extHost.protocol.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('MainThreadBrowsers work modes', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup() {
		const instantiation = workbenchInstantiationService(undefined, store);
		const input = store.add(instantiation.createInstance(BrowserEditorInput, { id: 'problem-browser', url: 'https://example.com/problem' }, async () => { throw new Error('Unexpected model resolution'); }));
		const modeChanged = store.add(new Emitter<void>());
		const mode = new class extends mock<IShortestPathModeService>() {
			override mode: ShortestPathMode = 'solve';
			override readonly activeBrowser = input;
			override readonly onDidChangeActiveBrowser = modeChanged.event;
			readonly opened: Parameters<IShortestPathModeService['openBrowser']>[] = [];
			override async openBrowser(...args: Parameters<IShortestPathModeService['openBrowser']>) { this.opened.push(args); return input; }
		};
		const activeIds: (string | undefined)[] = [];
		const proxy = new class extends mock<ExtHostBrowsersShape>() {
			override $onDidChangeActiveBrowserTab(id: string | undefined) { activeIds.push(id); }
			override $onDidOpenBrowserTab() { }
			override $onDidCloseBrowserTab() { }
		};
		instantiation.stub(IShortestPathModeService, mode);
		instantiation.stub(IBrowserViewWorkbenchService, new class extends mock<IBrowserViewWorkbenchService>() {
			override readonly onDidChangeBrowserViews = Event.None;
			override getKnownBrowserViews() { return new Map([[input.id, input]]); }
		});
		instantiation.stub(IEditorService, new class extends mock<IEditorService>() {
			override readonly onDidActiveEditorChange = Event.None;
			override readonly activeEditorPane = new class extends mock<IEditorPane>() { override readonly input = input; };
		});
		const service = store.add(instantiation.createInstance(MainThreadBrowsers, SingleProxyRPCProtocol(proxy)));
		return { service, mode, modeChanged, activeIds };
	}

	test('extension browser opens keep side-group and background placement in solving mode', async () => {
		const { service, mode } = setup();
		await service.$openBrowserTab('https://example.com/problem', SIDE_GROUP, { inactive: true, pinned: true });
		mode.mode = 'browse';
		await service.$openBrowserTab('https://example.com/problem', SIDE_GROUP, { preserveFocus: true });
		assert.deepStrictEqual(mode.opened, [
			['https://example.com/problem', true, true, { inactive: true, pinned: true, group: SIDE_GROUP }],
			['https://example.com/problem', true, true, { preserveFocus: true, group: undefined }],
		]);
	});

	test('a hidden solving editor is not reported active on mode pages', () => {
		const { mode, modeChanged, activeIds } = setup();
		for (const value of ['draw', 'browse', 'settings', 'solve'] as const) { mode.mode = value; modeChanged.fire(); }
		assert.deepStrictEqual(activeIds, ['problem-browser', undefined, 'problem-browser', undefined, 'problem-browser']);
	});
});
