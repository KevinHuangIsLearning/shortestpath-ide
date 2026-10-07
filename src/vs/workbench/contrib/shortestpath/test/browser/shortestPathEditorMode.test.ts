/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { EditorActivation, IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { EditorInputCapabilities } from '../../../../common/editor.js';
import { SideBySideEditorInput } from '../../../../common/editor/sideBySideEditorInput.js';
import { EditorService } from '../../../../services/editor/browser/editorService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { createEditorPart, ITestInstantiationService, registerTestEditor, TestFileEditorInput, workbenchInstantiationService, workbenchTeardown } from '../../../../test/browser/workbenchTestServices.js';
import { shouldRevealSolveEditor } from '../../browser/shortestPathEditorMode.js';

suite('ShortestPath editor mode', () => {
	const store = new DisposableStore();
	const inputId = 'shortestpath.mode.testEditorInput';
	let instantiation: ITestInstantiationService | undefined;

	teardown(async () => {
		if (instantiation) {
			await workbenchTeardown(instantiation);
			instantiation = undefined;
		}
		store.clear();
	});
	ensureNoDisposablesAreLeakedInTestSuite();

	test('background panel creation, repeated reveals and settings updates preserve the work mode', async () => {
		store.add(registerTestEditor('shortestpath.mode.testEditor', [new SyncDescriptor(TestFileEditorInput), new SyncDescriptor(SideBySideEditorInput)], inputId));
		instantiation = workbenchInstantiationService(undefined, store);
		instantiation.stub(ICommandService, { executeCommand: async () => undefined });
		const part = await createEditorPart(instantiation, store);
		instantiation.stub(IEditorGroupsService, part);
		const service = store.add(instantiation.createInstance(EditorService, undefined));
		await part.whenReady;
		const panel = store.add(new TestFileEditorInput(URI.parse('test://problem-panel'), inputId));
		const settings = store.add(new TestFileEditorInput(URI.parse('vscode-settings://settings'), inputId));
		const background = store.add(new TestFileEditorInput(URI.parse('test://background-source'), inputId));
		const decisions: boolean[] = [];
		store.add(service.onWillOpenEditor(event => decisions.push(shouldRevealSolveEditor(event))));

		// Webview creation and reveal both request preserveFocus. The second open
		// represents a bridge update caused by switching the webpage.
		await service.openEditor(panel, { pinned: true, preserveFocus: true });
		await service.openEditor(panel, { preserveFocus: true, activation: EditorActivation.RESTORE });
		await service.openEditor(settings, { pinned: true, preserveFocus: true });
		await service.openEditor(background, { inactive: true, pinned: true });
		await service.openEditor(panel, { preserveFocus: false });
		await service.openEditor(settings);
		// Companion panels can replace a source tab with a composite editor while
		// browsing. Its open event must preserve the mode just like a plain reveal.
		const companion = store.add(new TestFileEditorInput(URI.parse('test://companion'), inputId));
		const paired = store.add(new SideBySideEditorInput(undefined, undefined, companion, settings, service));
		await part.activeGroup.replaceEditors([{ editor: settings, replacement: paired, options: { preserveFocus: true, pinned: true }, forceReplaceDirty: true }]);
		await service.openEditor(paired);

		assert.deepStrictEqual(decisions, [false, false, false, false, true, true, false, true]);
	});

	test('foreground modal editors keep the current work mode', () => {
		const modal = store.add(new TestFileEditorInput(URI.parse('test://modal'), inputId));
		modal.capabilities = EditorInputCapabilities.RequiresModal;
		const options: IEditorOptions[] = [{}, { preserveFocus: false }, { preserveFocus: true }];
		assert.deepStrictEqual(options.map(options => shouldRevealSolveEditor({ editor: modal, groupId: 0, options })), [false, false, false]);
	});
});
