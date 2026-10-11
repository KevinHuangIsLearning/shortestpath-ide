/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { IDialogService } from '../../../../../platform/dialogs/common/dialogs.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { NullHoverService } from '../../../../../platform/hover/test/browser/nullHoverService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { ITitleService } from '../../../../services/title/browser/titleService.js';
import { ILifecycleService } from '../../../../services/lifecycle/common/lifecycle.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { IShortestPathUpdateIndicator, ShortestPathUpdateBlocker, ShortestPathUpdateChecker, ShortestPathUpdateContribution, ShortestPathUpdateIndicator } from '../../browser/shortestPathUpdate.contribution.js';

suite('ShortestPath update interaction', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function setupUpdate(currentVersion = '0.3.17', minimumSupportedVersion = '0.3.17') {
		const root = append(mainWindow.document.body, $('.monaco-workbench'));
		const navigation = append(root, $('.workbench-navigation'));
		const titlebar = append(root, $('.titlebar-navigation-container'));
		const right = append(root, $('.titlebar-right'));
		const updateHost = append(right, $('.shortestpath-titlebar-update-container'));
		const layout = store.add(new Emitter<{ width: number; height: number }>());
		const instantiation = store.add(new TestInstantiationService());
		const storage = store.add(new TestStorageService());
		instantiation.stub(IWorkbenchLayoutService, { mainContainer: root, mainWindowNavigationContainer: navigation, getContainer: () => root, onDidChangePartVisibility: Event.None, onDidLayoutMainContainer: layout.event });
		instantiation.stub(IHoverService, NullHoverService);
		instantiation.stub(ITitleService, { shortestPathUpdateContainer: updateHost });
		instantiation.stub(IProductService, { shortestPathVersion: currentVersion, shortestPathUpdateUrl: 'https://example.test/latest.json' });
		instantiation.stub(IStorageService, storage);
		instantiation.stub(ILogService, new NullLogService());
		instantiation.stub(ILifecycleService, { onWillShutdown: Event.None });
		instantiation.stub(IOpenerService, { open: async () => true });
		instantiation.stub(IDialogService, { confirm: async () => ({ confirmed: true }) });
		instantiation.stub(INotificationService, { info: () => undefined });
		instantiation.stubInstance(ShortestPathUpdateChecker, { check: async () => ({ release: { version: '0.3.18', minimumSupportedVersion, downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip' }, target: { downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip', allowsMinimumVersionLock: true }, fastDownloadUrl: undefined }) });
		const indicator = store.add(instantiation.createInstance(ShortestPathUpdateIndicator));
		instantiation.set(IShortestPathUpdateIndicator, indicator);
		store.add(toDisposable(() => { ShortestPathUpdateBlocker.dismiss(); root.remove(); }));
		return { root, navigation, instantiation, storage, indicator, layout, titlebar, updateHost };
	}

	test('compact updates stay outside navigation and survive title bar fallback', () => {
		const { root, navigation, indicator, layout, titlebar, updateHost } = setupUpdate();
		let opened = 0;
		indicator.show('0.3.18', () => opened++);
		const button = navigation.querySelector<HTMLButtonElement>('button')!;
		titlebar.append(navigation);
		navigation.classList.add('compact-navigation');
		layout.fire({ width: 800, height: 600 });
		button.click();
		assert.deepStrictEqual({ external: button.parentElement === updateHost, compact: button.classList.contains('compact-update-indicator'), hidden: button.hidden, opened }, { external: true, compact: true, hidden: false, opened: 1 });
		root.append(navigation);
		navigation.classList.remove('compact-navigation');
		layout.fire({ width: 800, height: 600 });
		assert.deepStrictEqual({ restored: button.parentElement === navigation, compact: button.classList.contains('compact-update-indicator'), hidden: button.hidden }, { restored: true, compact: false, hidden: false });
		indicator.clear();
		assert.strictEqual(button.hidden, true);
	});

	test('automatic ordinary check only shows the lower navigation entry; click and Escape control the card', async () => {
		const { root, navigation, instantiation } = setupUpdate();
		store.add(instantiation.createInstance(ShortestPathUpdateContribution));
		await timeout(0);
		const button = navigation.querySelector<HTMLButtonElement>('button')!;
		assert.deepStrictEqual({ hidden: button.hidden, dialogs: root.querySelectorAll('[role=dialog]').length }, { hidden: false, dialogs: 0 });
		button.focus();
		button.click();
		const card = root.querySelector<HTMLElement>('.shortestpath-update-available-overlay')!;
		assert.strictEqual(card.getAttribute('aria-modal'), 'false');
		const tab = new mainWindow.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
		card.dispatchEvent(tab);
		assert.strictEqual(tab.defaultPrevented, false);
		card.dispatchEvent(new mainWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		assert.deepStrictEqual({ dialogs: root.querySelectorAll('[role=dialog]').length, focused: mainWindow.document.activeElement === button, hidden: button.hidden }, { dialogs: 0, focused: true, hidden: false });
	});

	test('manual ordinary check is quiet and a later latest result clears the entry', async () => {
		const { root, navigation, instantiation } = setupUpdate();
		const command = CommandsRegistry.getCommand('shortestpath.action.checkForUpdates')!;
		await instantiation.invokeFunction(accessor => command.handler(accessor));
		assert.deepStrictEqual({ hidden: navigation.querySelector<HTMLButtonElement>('button')!.hidden, dialogs: root.querySelectorAll('[role=dialog]').length }, { hidden: false, dialogs: 0 });
		instantiation.stubInstance(ShortestPathUpdateChecker, { check: async () => ({ release: { version: '0.3.17', downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip' }, target: undefined, fastDownloadUrl: undefined }) });
		await instantiation.invokeFunction(accessor => command.handler(accessor));
		assert.strictEqual(navigation.querySelector<HTMLButtonElement>('button')!.hidden, true);
	});

	test('minimum version enforcement replaces an open ordinary card after grace expires', async () => {
		const { root, navigation, instantiation, storage } = setupUpdate('0.3.16');
		const contribution = store.add(instantiation.createInstance(ShortestPathUpdateContribution));
		await timeout(0);
		assert.strictEqual(ShortestPathUpdateBlocker.hasRequiredUpdate, true);
		root.querySelector<HTMLButtonElement>('.shortestpath-update-required-network')!.click();
		await timeout(0);
		assert.strictEqual(navigation.querySelector<HTMLButtonElement>('button')!.hidden, false);
		navigation.querySelector<HTMLButtonElement>('button')!.click();
		assert.strictEqual(root.querySelector('[role=dialog]')?.getAttribute('aria-modal'), 'false');
		storage.store('shortestpath.update.networkGrace', { version: '0.3.16', minimumSupportedVersion: '0.3.17', downloadUrl: 'https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip', graceUntil: Date.now() - 1 }, StorageScope.APPLICATION, StorageTarget.MACHINE);
		await timeout(0);
		await timeout(0);
		assert.deepStrictEqual({ required: ShortestPathUpdateBlocker.hasRequiredUpdate, modal: root.querySelector('[role=dialog]')?.getAttribute('aria-modal'), hidden: navigation.querySelector<HTMLButtonElement>('button')!.hidden }, { required: true, modal: 'true', hidden: true });
		contribution.dispose();
	});
});
