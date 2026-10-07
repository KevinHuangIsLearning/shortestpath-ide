/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Dimension } from '../../../base/browser/dom.js';
import { isFullscreen, setFullscreen } from '../../../base/browser/browser.js';
import { mainWindow } from '../../../base/browser/window.js';
import { Direction, Grid, IView, Orientation } from '../../../base/browser/ui/grid/grid.js';
import { TestView } from '../../../base/test/browser/ui/grid/util.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { isWeb } from '../../../base/common/platform.js';
import { TestConfigurationService } from '../../../platform/configuration/test/common/testConfigurationService.js';
import { StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
import { Layout, LayoutStateKeys, LayoutStateModel } from '../../browser/layout.js';
import { NavigationView } from '../../browser/parts/navigation/navigationView.js';
import { Parts, Position, shouldShowCustomTitleBar } from '../../services/layout/browser/layoutService.js';
import { TestContextService, TestStorageService } from '../common/workbenchTestServices.js';

suite('Workbench navigation column', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	(isWeb ? test.skip : test)('windowed hides the command center titlebar in fullscreen and restores it on exit', () => {
		const configuration = new TestConfigurationService({
			window: { titleBarStyle: 'custom', customTitleBarVisibility: 'windowed', commandCenter: true },
			workbench: { layoutControl: { enabled: true } }
		});
		const originalFullscreen = isFullscreen(mainWindow);
		try {
			const visibility = [false, true, false].map(fullscreen => {
				setFullscreen(fullscreen, mainWindow);
				return shouldShowCustomTitleBar(configuration, mainWindow);
			});
			assert.deepStrictEqual(visibility, [true, false, true]);
		} finally {
			setFullscreen(originalFullscreen, mainWindow);
		}
	});
	test('desktop solving metrics are enabled before the mode contribution starts', () => {
		const layout = Object.assign(Object.create(Layout.prototype), {
			state: { runtime: { mainWindowFullscreen: false } },
			configurationService: new TestConfigurationService(),
			isVisible: () => true,
			getPanelPosition: () => Position.BOTTOM,
			getPanelAlignment: () => 'center',
		}) as Layout;
		assert.strictEqual(layout.getLayoutClasses().includes('shortestpath-dual-mode'), !isWeb);
	});

	test('reserves a fixed column as the window resizes and workbench content is hidden', () => {
		const navigation = new NavigationView();
		const editor = store.add(new TestView(100, Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY));
		const sidebar = store.add(new TestView(100, Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY));
		const grid = store.add(new Grid<IView>(navigation));
		grid.orientation = Orientation.HORIZONTAL;
		grid.addView(editor, 744, navigation, Direction.Right);
		grid.addView(sidebar, 200, editor, Direction.Left);
		for (const width of [800, 1200, 600]) {
			grid.layout(width, 600);
			grid.setViewVisible(sidebar, false);
			assert.deepStrictEqual({ navigation: grid.getViewSize(navigation), editor: editor.size, left: editor.left }, { navigation: { width: 48, height: 600 }, editor: [width - 48, 600], left: 48 });
			grid.setViewVisible(sidebar, true);
		}
	});
});

suite('ShortestPath secondary side bar', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	function load(stored: Record<string, boolean | object> = {}, resetLayout = false): LayoutStateModel {
		const storage = disposables.add(new TestStorageService());
		for (const [key, value] of Object.entries(stored)) {
			storage.store(`workbench.${key}`, typeof value === 'object' ? JSON.stringify(value) : value, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
		const configuration = new TestConfigurationService({
			workbench: { secondarySideBar: { defaultVisibility: 'maximized', forceMaximized: true } }
		});
		const model = disposables.add(new LayoutStateModel(storage, configuration, new TestContextService()));
		model.load({ mainContainerDimension: new Dimension(1200, 800), resetLayout });
		return model;
	}

	test('fresh and reset layouts ignore visible and forced maximized settings', () => {
		for (const reset of [false, true]) {
			const model = load({}, reset);
			assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.AUXILIARYBAR_HIDDEN), true);
			assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.AUXILIARYBAR_WAS_LAST_MAXIMIZED), false);
			assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.EDITOR_HIDDEN), false);
			assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.SIDEBAR_HIDDEN), false);
		}
	});

	test('restored visible side bar stays hidden without changing other parts', () => {
		const model = load({ 'auxiliaryBar.hidden': false, 'sideBar.hidden': false, 'panel.hidden': false });
		assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.AUXILIARYBAR_HIDDEN), true);
		assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.SIDEBAR_HIDDEN), false);
		assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.PANEL_HIDDEN), false);
	});

	test('restored maximized side bar recovers the previous editor and panel layout', () => {
		const model = load({
			'auxiliaryBar.hidden': false,
			'auxiliaryBar.wasLastMaximized': true,
			'auxiliaryBar.lastNonMaximizedVisibility': { sideBarVisible: true, editorVisible: true, panelVisible: false, auxiliaryBarVisible: true },
			'editor.hidden': true, 'panel.hidden': true, 'sideBar.hidden': true
		});
		assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.AUXILIARYBAR_HIDDEN), true);
		assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.AUXILIARYBAR_WAS_LAST_MAXIMIZED), false);
		assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.EDITOR_HIDDEN), false);
		assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.SIDEBAR_HIDDEN), false);
		assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.PANEL_HIDDEN), true);
	});

	test('incomplete old maximized layout cannot leave both editor and panel hidden', () => {
		const model = load({ 'auxiliaryBar.wasLastMaximized': true, 'editor.hidden': true, 'panel.hidden': true });
		assert.strictEqual(model.getRuntimeValue(LayoutStateKeys.EDITOR_HIDDEN), false);
	});

	test('programmatic show, maximize and toggles cannot reveal or resize parts', () => {
		// No grid or services: a forbidden show/maximize must return before using them.
		const layout = Object.create(Layout.prototype) as Layout;
		layout.setPartHidden(false, Parts.AUXILIARYBAR_PART);
		assert.strictEqual(layout.setAuxiliaryBarMaximized(true), false);
		assert.strictEqual(layout.setAuxiliaryBarMaximized(false), false);
		const hidden: { hidden: boolean; part: Parts }[] = [];
		layout.setPartHidden = (hiddenValue, part) => { hidden.push({ hidden: hiddenValue, part }); };
		layout.toggleSecondarySideBar();
		assert.deepStrictEqual(hidden, [{ hidden: true, part: Parts.AUXILIARYBAR_PART }]);
	});
});
