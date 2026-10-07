/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../../common/editor.js';
import { findGroup } from '../../../../services/editor/common/editorGroupFinder.js';
import { SIDE_GROUP } from '../../../../services/editor/common/editorService.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { createEditorParts, registerTestEditor, TestFileEditorInput, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';

suite('ShortestPath native browser container', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('native tabs keep independent models and unregister on disposal', async () => {
		store.add(registerTestEditor('nativeBrowserContainerTest', [new SyncDescriptor(TestFileEditorInput)]));
		const instantiation = workbenchInstantiationService(undefined, store);
		instantiation.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiation, store.add(new DisposableStore()));
		instantiation.stub(IEditorGroupsService, parts);
		const container = document.createElement('div');
		document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		const browse = store.add(parts.createEmbeddedEditorPart(container));
		store.add(browse.enforcePartOptions({ showTabs: 'multiple', enablePreview: false }));
		browse.layout(800, 600, 0, 0);
		const solveInput = store.add(new TestFileEditorInput(URI.parse('test://solve'), 'nativeBrowserContainerInput'));
		const first = store.add(new TestFileEditorInput(URI.parse('test://browser/first'), 'nativeBrowserContainerInput'));
		const second = store.add(new TestFileEditorInput(URI.parse('test://browser/second'), 'nativeBrowserContainerInput'));
		await parts.mainPart.activeGroup.openEditor(solveInput, { pinned: true });
		await browse.activeGroup.openEditor(first, { pinned: true });
		await browse.activeGroup.openEditor(second, { pinned: true });
		browse.activeGroup.moveEditor(second, browse.activeGroup, { index: 0 });
		await browse.activeGroup.closeEditor(first);
		browse.activeGroup.focus();
		const [defaultGroup] = await instantiation.invokeFunction(accessor => findGroup(accessor, { editor: solveInput }, undefined));
		const [sideGroup] = await instantiation.invokeFunction(accessor => findGroup(accessor, { editor: solveInput }, SIDE_GROUP));
		const [explicitGroup] = await instantiation.invokeFunction(accessor => findGroup(accessor, { editor: second }, browse.activeGroup));
		const snapshot = {
			solve: parts.mainPart.activeGroup.editors.map(input => input.resource?.toString()),
			browse: browse.activeGroup.editors.map(input => input.resource?.toString()),
			nativeTabCount: container.querySelectorAll('.tab').length,
			defaultInMain: parts.getPart(defaultGroup.id) === parts.mainPart,
			sideInMain: parts.getPart(sideGroup.id) === parts.mainPart,
			explicitInBrowse: explicitGroup === browse.activeGroup,
			groupOwner: parts.getPart(browse.activeGroup.id) === browse,
			elementOwner: parts.getPart(container) === browse,
		};
		await browse.activeGroup.closeEditor(second);
		browse.dispose();
		assert.deepStrictEqual({ ...snapshot, unregistered: !parts.groups.some(group => group.id === browse.activeGroup.id) }, {
			solve: ['test://solve'], browse: ['test://browser/second'], nativeTabCount: 1, defaultInMain: true, sideInMain: true, explicitInBrowse: true, groupOwner: true, elementOwner: true, unregistered: true,
		});
	});
});
