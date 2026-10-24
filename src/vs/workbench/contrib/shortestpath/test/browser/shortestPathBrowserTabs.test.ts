/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Emitter } from '../../../../../base/common/event.js';
import '../../browser/media/shortestPathBrowserTabBar.css';
import { URI } from '../../../../../base/common/uri.js';
import { DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorExtensions, IEditorFactoryRegistry } from '../../../../common/editor.js';
import { findGroup } from '../../../../services/editor/common/editorGroupFinder.js';
import { SIDE_GROUP } from '../../../../services/editor/common/editorService.js';
import { IEditorGroupsService, GroupDirection } from '../../../../services/editor/common/editorGroupsService.js';
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
			groupOwner: Object.is(parts.getPart(browse.activeGroup.id), browse),
			elementOwner: Object.is(parts.getPart(container), browse),
		};
		await browse.activeGroup.closeEditor(second);
		browse.dispose();
		assert.deepStrictEqual({ ...snapshot, unregistered: !parts.groups.some(group => group.id === browse.activeGroup.id) }, {
			solve: ['test://solve'], browse: ['test://browser/second'], nativeTabCount: 1, defaultInMain: true, sideInMain: true, explicitInBrowse: true, groupOwner: true, elementOwner: true, unregistered: true,
		});
	});
	test('split groups keep their own native strips and sidebar insets preserve the native views', async () => {
		store.add(registerTestEditor('nativeBrowserSplitTest', [new SyncDescriptor(TestFileEditorInput)]));
		const instantiation = workbenchInstantiationService(undefined, store);
		instantiation.invokeFunction(accessor => Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).start(accessor));
		const parts = await createEditorParts(instantiation, store.add(new DisposableStore()));
		instantiation.stub(IEditorGroupsService, parts);
		const container = document.createElement('div');
		container.className = 'shortestpath-browser-host';
		document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		const browse = store.add(parts.createEmbeddedEditorPart(container));
		const clicks: string[] = [];
		const visibility = store.add(new Emitter<void>());
		let represented: TestFileEditorInput | undefined;
		const urlInput = document.createElement('input');
		document.body.appendChild(urlInput);
		store.add(toDisposable(() => urlInput.remove()));
		store.add(browse.enforcePartOptions({
			showTabs: 'multiple', enablePreview: false, wrapTabs: false,
			isTabVisible: (editor: EditorInput) => editor !== represented,
			onDidChangeTabVisibility: visibility.event,
			createTabsLeading: (target: unknown, groupId: number) => {
				const element = target as HTMLElement;
				element.textContent = `Favorites ${groupId}`;
				return toDisposable(() => element.remove());
			},
			onActiveTabClick: (editor: TestFileEditorInput, groupId: number) => { clicks.push(`${groupId}:${editor.resource}`); urlInput.focus(); },
		}));
		const firstGroup = browse.activeGroup;
		const secondGroup = browse.addGroup(firstGroup, GroupDirection.RIGHT);
		const first = store.add(new TestFileEditorInput(URI.parse('test://browser/A'), 'nativeBrowserSplitInput'));
		const second = store.add(new TestFileEditorInput(URI.parse('test://browser/B'), 'nativeBrowserSplitInput'));
		await firstGroup.openEditor(first, { pinned: true });
		await secondGroup.openEditor(second, { pinned: true });
		browse.layout(1000, 600, 0, 0);
		const strips = container.querySelectorAll('.tabs-container');
		assert.strictEqual(strips.length, 2);
		assert.deepStrictEqual(Array.from(strips, strip => strip.querySelectorAll('.tab').length), [1, 1]);
		assert.strictEqual(container.querySelectorAll('.editor-tabs-leading').length, 2);
		const tab = strips[0].querySelector<HTMLElement>('.tab')!;
		tab.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
		tab.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
		tab.dispatchEvent(new MouseEvent('click', { button: 0, bubbles: true }));
		await new Promise(resolve => setTimeout(resolve, 10));
		assert.strictEqual(document.activeElement, urlInput);
		assert.deepStrictEqual(clicks, [`${firstGroup.id}:test://browser/A`]);
		represented = first; visibility.fire();
		assert.deepStrictEqual({ hidden: tab.style.display, model: firstGroup.activeEditor, otherVisible: (strips[1].querySelector('.tab') as HTMLElement).style.display }, { hidden: 'none', model: first, otherVisible: '' });
		represented = undefined; visibility.fire();
		assert.strictEqual(tab.style.display, '');
		const third = store.add(new TestFileEditorInput(URI.parse('test://browser/WWWWW'), 'nativeBrowserSplitInput'));
		await firstGroup.openEditor(third, { pinned: true });
		firstGroup.stickEditor(first);
		store.add(browse.enforcePartOptions({ pinnedTabSizing: 'compact' }));
		container.classList.add('modern-ui', 'modern-ui-connected-editor-tabs');
		browse.layout(1000, 600, 0, 0);
		await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => resolve())));
		const thirdTab = strips[0].querySelectorAll<HTMLElement>('.tab')[1];
		const minimumBefore = thirdTab.style.getPropertyValue('--connected-tab-min-name-width');
		represented = first; visibility.fire();
		browse.layout(1000, 600, 0, 0);
		await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => resolve())));
		assert.strictEqual(thirdTab.style.getPropertyValue('--connected-tab-min-name-width'), minimumBefore);
		container.classList.remove('modern-ui-connected-editor-tabs');
		browse.layout(1000, 600, 0, 0);
		await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => resolve())));
		assert.strictEqual(strips[0].parentElement!.querySelector<HTMLElement>('.sticky-tabs-background')!.style.width, '0px');
		store.add(browse.enforcePartOptions({ wrapTabs: true }));
		represented = third; visibility.fire();
		browse.layout(1000, 600, 0, 0);
		await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => resolve())));
		assert.deepStrictEqual(Array.from(strips[0].querySelectorAll<HTMLElement>('.tab'), item => ({ hidden: item.style.display === 'none', last: item.classList.contains('last-visible-tab') })), [{ hidden: false, last: true }, { hidden: true, last: false }]);
		represented = undefined; visibility.fire();
		await firstGroup.closeEditor(third);
		const sidebar = store.add(browse.createGroupSidebar(firstGroup, 200));
		browse.layout(1000, 600, 0, 0);
		const sideRect = (sidebar.container as HTMLElement).getBoundingClientRect();
		const firstPane = (sidebar.container as HTMLElement).parentElement!.querySelector<HTMLElement>('.editor-container')!.getBoundingClientRect();
		assert.ok(firstPane.left >= sideRect.right && firstPane.width > 0, JSON.stringify({ firstPane: firstPane.toJSON(), sidebar: sideRect.toJSON() }));
		sidebar.dispose();
		assert.strictEqual(firstGroup.activeEditor, first);
		assert.strictEqual(secondGroup.activeEditor, second);
		assert.strictEqual(container.querySelectorAll('.tab').length, 2);
	});

});
