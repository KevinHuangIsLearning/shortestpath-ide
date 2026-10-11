/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { PaneCompositeBar } from '../../../browser/parts/paneCompositeBar.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('ShortestPath activity container visibility', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('integrated SP tests override the default CPH pin and restore it for other sources', () => {
		let integrated = false;
		const bar = Object.create(PaneCompositeBar.prototype) as {
			options: { pinnedViewContainersKey: string };
			contextKeyService: { getContextKeyValue(key: string): boolean };
			shouldBeHidden(container: { id: string }): boolean;
		};
		bar.options = { pinnedViewContainersKey: 'workbench.activity.pinnedViewlets2' };
		bar.contextKeyService = { getContextKeyValue: key => key === 'shortestpath.oj.integratedLocalTests' && integrated };
		const cph = { id: 'workbench.view.extension.cph-judge-view-container' };
		assert.strictEqual(bar.shouldBeHidden(cph), false);
		integrated = true;
		assert.strictEqual(bar.shouldBeHidden(cph), true);
		assert.strictEqual(bar.shouldBeHidden({ id: 'workbench.view.explorer' }), false);
		integrated = false;
		assert.strictEqual(bar.shouldBeHidden(cph), false);
	});
	test('Sketchpad shows only its native file container and restores Solve containers on exit', () => {
		let drawing = false;
		const bar = Object.create(PaneCompositeBar.prototype) as {
			options: { pinnedViewContainersKey: string };
			contextKeyService: { getContextKeyValue(key: string): boolean };
			shouldBeHidden(container: { id: string }): boolean;
		};
		bar.options = { pinnedViewContainersKey: 'workbench.activity.pinnedViewlets2' };
		bar.contextKeyService = { getContextKeyValue: key => key === 'shortestpath.drawMode' && drawing };
		const containers = ['workbench.view.explorer', 'workbench.view.search', 'workbench.view.extension.cph-judge-view-container', 'workbench.view.extension.shortestpath-draw'].map(id => ({ id }));
		const visibility = () => containers.map(container => !bar.shouldBeHidden(container));
		assert.deepStrictEqual(visibility(), [true, true, true, false]);
		drawing = true;
		assert.deepStrictEqual(visibility(), [false, false, false, true]);
		drawing = false;
		assert.deepStrictEqual(visibility(), [true, true, true, false]);
	});

	test('Sketchpad filtering survives native activation and shared pin updates', () => {
		const explorer = { id: 'workbench.view.explorer', name: 'Files', pinned: true, visible: true };
		const drawing = { id: 'workbench.view.extension.shortestpath-draw', name: 'Sketchpad', pinned: true, visible: false };
		let inDrawingMode = true;
		const added: string[] = [];
		const hidden: string[] = [];
		let updated: { id: string; visible: boolean; pinned: boolean }[] = [];
		const bar = Object.create(PaneCompositeBar.prototype) as {
			onDidViewContainerVisible(id: string): void;
			updateCompositeBarItemsFromStorage(retainExisting: boolean): void;
		};
		Object.defineProperties(bar, {
			options: { value: { pinnedViewContainersKey: 'workbench.activity.pinnedViewlets2' } },
			contextKeyService: { value: { getContextKeyValue: () => inDrawingMode } },
			getViewContainer: { value: (id: string) => ({ id }) },
			getViewContainers: { value: () => [] },
			pinnedViewContainersValue: { value: 'old' },
			getStoredPinnedViewContainersValue: { value: () => 'updated' },
			cachedViewContainers: { value: [explorer, drawing] },
			hideComposite: { value: (id: string) => hidden.push(id) },
			addComposite: { value: (container: { id: string }) => added.push(container.id) },
			compositeBar: {
				value: {
					activateComposite: (id: string) => added.push(id),
					getCompositeBarItems: () => [],
					setCompositeBarItems: (items: typeof updated) => { updated = items; },
				}
			},
		});
		bar.onDidViewContainerVisible(explorer.id);
		assert.deepStrictEqual({ added, hidden }, { added: [], hidden: [explorer.id] });
		bar.updateCompositeBarItemsFromStorage(true);
		assert.deepStrictEqual(updated.map(({ id, visible, pinned }) => ({ id, visible, pinned })), [
			{ id: explorer.id, visible: false, pinned: true },
			{ id: drawing.id, visible: true, pinned: true },
		]);
		inDrawingMode = false;
		explorer.visible = false;
		drawing.visible = true;
		bar.updateCompositeBarItemsFromStorage(true);
		assert.deepStrictEqual(updated.map(({ visible, pinned }) => ({ visible, pinned })), [
			{ visible: true, pinned: true },
			{ visible: false, pinned: true },
		]);
	});

});
