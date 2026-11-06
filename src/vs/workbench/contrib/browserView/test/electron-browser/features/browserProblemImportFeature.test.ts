/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { timeout } from '../../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { toDisposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { mock } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { IEditorGroup } from '../../../../../services/editor/common/editorGroupsService.js';
import { TestFileEditorInput, workbenchInstantiationService } from '../../../../../test/browser/workbenchTestServices.js';
import { IShortestPathModeService } from '../../../../shortestpath/common/shortestPathMode.js';
import { BrowserEditorInput } from '../../../common/browserEditorInput.js';
import { BrowserSourceEditorInput } from '../../../common/browserSourceEditorInput.js';
import { IBrowserViewModel } from '../../../common/browserView.js';
import { BrowserEditor } from '../../../electron-browser/browserEditor.js';
import { BrowserProblemImportFeature } from '../../../electron-browser/features/browserProblemImportFeature.js';

suite('Problem import surface', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setup(paired: boolean) {
		const instantiation = workbenchInstantiationService(undefined, store);
		instantiation.stub(IShortestPathModeService, new class extends mock<IShortestPathModeService>() {
			override readonly onDidChangeActiveBrowser = Event.None;
		});
		const calls: string[] = [];
		instantiation.stub(ICommandService, new class extends mock<ICommandService>() {
			override async executeCommand<T>(id: string): Promise<T> { calls.push(id); return true as T; }
		});
		const input = store.add(instantiation.createInstance(BrowserEditorInput, { id: 'problem', url: 'https://example.com/problem' }, async () => { throw new Error('Unexpected resolution'); }));
		const source = store.add(new TestFileEditorInput(URI.file('/workspace/main.cpp'), 'test'));
		const owner = paired ? store.add(instantiation.createInstance(BrowserSourceEditorInput, input, source, undefined)) : input;
		const changes = store.add(new Emitter<{ model: IBrowserViewModel; isNew: boolean }>());
		const editor = new class extends mock<BrowserEditor>() {
			override readonly onDidChangeModel = changes.event;
			override get input() { return input; }
			override readonly group = new class extends mock<IEditorGroup>() { override readonly editors = [owner]; };
		};
		const feature = store.add(instantiation.createInstance(BrowserProblemImportFeature, editor));
		const model = new class extends mock<IBrowserViewModel>() {
			override readonly url = input.url!;
			override readonly loading = false;
			override readonly onDidNavigate = Event.None;
			override readonly onDidChangeLoadingState = Event.None;
			override readonly onDidChangeTitle = Event.None;
		};
		feature.prerenderInput(input);
		changes.fire({ model, isNew: false });
		return { feature, calls, instantiation };
	}

	test('paired problem pages neither offer import nor detect or import again', async () => {
		const { feature, calls, instantiation } = setup(true);
		await timeout(550);
		await feature.importProblem();
		assert.deepStrictEqual({
			canImport: instantiation.get(IContextKeyService).getContextKeyValue('shortestpath.browserCanImportProblem'),
			hidden: feature.widgets[0].element.hidden,
			calls,
		}, { canImport: false, hidden: true, calls: [] });
	});

	test('standalone hints keep the editor window width after entering a narrow overlay viewport', async () => {
		const { feature } = setup(false);
		const root = mainWindow.document.body.appendChild(mainWindow.document.createElement('div'));
		root.className = 'browser-root';
		store.add(toDisposable(() => root.remove()));
		const container = root.appendChild(mainWindow.document.createElement('div'));
		feature.onContainerCreated(container);
		await timeout(550);
		const hint = feature.widgets[0].element;
		const maxWidth = `${Math.max(0, mainWindow.innerWidth - 16)}px`;
		const frame = root.appendChild(mainWindow.document.createElement('iframe'));
		frame.style.width = '64px';
		frame.contentDocument!.body.appendChild(hint);
		feature.afterContainerLayout();
		feature.afterContainerLayout();
		assert.deepStrictEqual({ hidden: hint.hidden, maxWidth: hint.style.maxWidth }, { hidden: false, maxWidth });
	});
});
