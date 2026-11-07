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
import { IEditorGroup, IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { workbenchInstantiationService } from '../../../test/browser/workbenchTestServices.js';
import { BrowserEditorInput } from '../../../contrib/browserView/common/browserEditorInput.js';
import { IBrowserViewModel, IBrowserViewWorkbenchService } from '../../../contrib/browserView/common/browserView.js';
import { IShortestPathModeService, ShortestPathMode } from '../../../contrib/shortestpath/common/shortestPathMode.js';
import { MainThreadBrowsers } from '../../browser/mainThreadBrowsers.js';
import { ExtHostBrowsersShape } from '../../common/extHost.protocol.js';
import { SingleProxyRPCProtocol } from '../common/testRPCProtocol.js';

suite('MainThreadBrowsers work modes', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup(loadURL?: (url: string) => Promise<void>) {
		const instantiation = workbenchInstantiationService(undefined, store);
		const input = store.add(instantiation.createInstance(BrowserEditorInput, { id: 'problem-browser', url: 'https://example.com/problem' }, async () => { throw new Error('Unexpected model resolution'); }));
		if (loadURL) {
			const navigate = loadURL;
			const model = new class extends mock<IBrowserViewModel>() { override loadURL = navigate; };
			input.resolve = async () => model;
		}
		const modeChanged = store.add(new Emitter<void>());
		const mode = new class extends mock<IShortestPathModeService>() {
			override mode: ShortestPathMode = 'solve';
			override readonly activeBrowser = input;
			override readonly onDidChangeActiveBrowser = modeChanged.event;
			readonly opened: Parameters<IShortestPathModeService['openBrowser']>[] = [];
			override async openBrowser(...args: Parameters<IShortestPathModeService['openBrowser']>) { this.opened.push(args); return input; }
			readonly shown: BrowserEditorInput[] = [];
			override async showBrowser(input: BrowserEditorInput) { this.shown.push(input); }
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
			override async createBrowserView() { return input; }
		});
		instantiation.stub(IEditorService, new class extends mock<IEditorService>() {
			override readonly onDidActiveEditorChange = Event.None;
			override readonly activeEditorPane = new class extends mock<IEditorPane>() { override readonly input = input; };
		});
		const service = store.add(instantiation.createInstance(MainThreadBrowsers, SingleProxyRPCProtocol(proxy)));
		return { service, mode, modeChanged, activeIds, input, instantiation };
	}

	test('a hidden connection page can be shown before its navigation completes', async () => {
		let finishNavigation!: () => void;
		const navigation = new Promise<void>(resolve => { finishNavigation = resolve; });
		const urls: string[] = [];
		const { service, mode } = setup(url => { urls.push(url); return navigation; });
		try {
			const tab = await service.$openBrowserTab('https://example.com/ide/connect?token=test', undefined, { hidden: true });
			mode.mode = 'browse';
			await service.$showBrowserTab(tab.id);
			assert.deepStrictEqual({ urls, shown: mode.shown.map(input => input.id) }, {
				urls: ['https://example.com/ide/connect?token=test'], shown: [tab.id],
			});
		} finally { finishNavigation(); }
	});

	test('hiding a revealed background tab removes its editor without disposing its browser', async () => {
		const { service, mode, input, instantiation } = setup(async () => { });
		let closed = 0;
		const group = new class extends mock<IEditorGroup>() {
			override contains(editor: EditorInput) { return editor === input; }
			override async closeEditor(editor: EditorInput) { closed++; editor.dispose(); return true; }
		};
		instantiation.stub(IEditorGroupsService, 'groups', [group]);
		const tab = await service.$openBrowserTab('https://example.com/ide/connect', undefined, { hidden: true });
		await service.$showBrowserTab(tab.id);
		await service.$hideBrowserTab(tab.id);
		await service.$showBrowserTab(tab.id);
		assert.deepStrictEqual({ closed, disposed: input.isDisposed(), shown: mode.shown.length }, { closed: 1, disposed: false, shown: 2 });
	});

	test('hiding an ordinary visible tab leaves it open', async () => {
		const { service, input } = setup();
		await service.$hideBrowserTab(input.id);
		assert.strictEqual(input.isDisposed(), false);
	});

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
