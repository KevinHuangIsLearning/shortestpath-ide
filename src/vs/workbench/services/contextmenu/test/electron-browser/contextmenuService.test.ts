/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, registerWindowViewportOffset } from '../../../../../base/browser/dom.js';
import { isMacintosh } from '../../../../../base/common/platform.js';
import { StandardMouseEvent } from '../../../../../base/browser/mouseEvent.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { Action, ActionRunner, SubmenuAction } from '../../../../../base/common/actions.js';
import { DeferredPromise } from '../../../../../base/common/async.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { IContextMenuItem } from '../../../../../base/parts/contextmenu/common/contextmenu.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FocusMode } from '../../../../../platform/native/common/native.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IHostService } from '../../../host/browser/host.js';
import { NativeContextMenuService } from '../../electron-browser/contextmenuService.js';

suite('Native ContextMenuService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	let service: NativeContextMenuService;
	let focus: DeferredPromise<void>;
	let calls: string[];
	let focusedWindow: Window | undefined;
	let focusMode: FocusMode | undefined;
	let menu: IContextMenuItem[];
	let closeMenu: (() => void) | undefined;
	let coordinates: { x?: number; y?: number };

	setup(() => {
		calls = [];
		focus = new DeferredPromise<void>();
		focusedWindow = undefined;
		focusMode = undefined;
		menu = [];
		closeMenu = undefined;
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IHostService, {
			focus: async (targetWindow, options) => {
				calls.push('focus');
				focusedWindow = targetWindow;
				focusMode = options?.mode;
				await focus.p;
			},
		});
		service = store.add(instantiationService.createInstance(NativeContextMenuService, (items, _options, onHide) => {
			menu = items;
			coordinates = _options ?? {};
			closeMenu = onHide;
		}));
	});

	for (const mouseAnchor of [false, true]) {
		for (const mode of ['action', 'submenu', 'action runner'] as const) {
			test(`activates the ${mouseAnchor ? 'mouse' : 'element'} anchor's window before running a selected ${mode}`, async () => {
				const frame = mainWindow.document.createElement('iframe');
				mainWindow.document.body.appendChild(frame);
				store.add(toDisposable(() => frame.remove()));
				const targetWindow = frame.contentWindow!;
				const didRun = new DeferredPromise<void>();
				const action = store.add(new Action('test', 'Test', undefined, true, async () => {
					calls.push('run');
					didRun.complete();
				}));
				const actions = [mode === 'submenu' ? new SubmenuAction('submenu', 'Submenu', [action]) : action];
				service.showContextMenu({
					getAnchor: () => mouseAnchor
						? new StandardMouseEvent(targetWindow, new MouseEvent('contextmenu', { view: targetWindow }))
						: frame.contentDocument!.body,
					getActions: () => actions,
					actionRunner: mode === 'action runner' ? store.add(new ActionRunner()) : undefined,
					onHide: () => calls.push('hide'),
				});
				const beforeSelection = [...calls];
				const item = mode === 'submenu' ? menu[0].submenu![0] : menu[0];
				item.click!({});
				const beforeActivation = [...calls];
				await focus.complete();
				await didRun.p;

				assert.deepStrictEqual({ beforeSelection, beforeActivation, calls, focusedWindow, focusMode }, {
					beforeSelection: [],
					beforeActivation: ['hide', 'focus'],
					calls: ['hide', 'focus', 'run'],
					focusedWindow: targetWindow,
					focusMode: FocusMode.Force,
				});
			});
		}
	}

	test('does not activate the window when dismissing the menu', () => {
		const action = store.add(new Action('test', 'Test'));
		service.showContextMenu({
			getAnchor: () => mainWindow.document.body,
			getActions: () => [action],
			onHide: () => calls.push('hide'),
		});
		closeMenu!();

		assert.deepStrictEqual(calls, ['hide']);
	});

	for (const mouseAnchor of [false, true]) {
		test(`${mouseAnchor ? 'uses the native cursor' : 'uses host coordinates'} for a child view's menu anchor`, () => {
			const frame = mainWindow.document.body.appendChild($('iframe')) as HTMLIFrameElement;
			store.add(toDisposable(() => frame.remove()));
			const target = frame.contentWindow!;
			store.add(registerWindowViewportOffset(target, () => ({ x: 100, y: 200, width: 800, height: 600 })));
			const anchor = frame.contentDocument!.body.appendChild($('div'));
			anchor.style.cssText = 'position: absolute; left: 10px; top: 20px; width: 30px; height: 40px;';
			const action = store.add(new Action('test', 'Test'));
			service.showContextMenu({
				getAnchor: () => mouseAnchor ? new StandardMouseEvent(target, new MouseEvent('contextmenu', { view: target, clientX: 10, clientY: 20 })) : anchor,
				getActions: () => [action]
			});
			assert.deepStrictEqual({ x: coordinates.x, y: coordinates.y }, { x: mouseAnchor ? undefined : 140, y: mouseAnchor ? undefined : 260 + (isMacintosh ? 4 : 0) });
		});
	}

});
