/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import { MenuId, MenuRegistry, isIMenuItem } from '../../../../../platform/actions/common/actions.js';
import { BrowserViewCommandId } from '../../../../../platform/browserView/common/browserView.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { KeybindingsRegistry } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { SideBySideEditor } from '../../../../browser/parts/editor/sideBySideEditor.js';
import { SIDE_BY_SIDE_EDITOR_ID } from '../../../../common/editor.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { TestEditorGroupView, TestFileEditorInput, workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { BrowserEditorInput } from '../../../browserView/common/browserEditorInput.js';
import { BrowserSourceEditorInput } from '../../../browserView/common/browserSourceEditorInput.js';
import { IBrowserViewModel } from '../../../browserView/common/browserView.js';
import { BROWSER_EDITOR_ACTIVE, BrowserEditor, CONTEXT_BROWSER_FOCUSED, CONTEXT_BROWSER_HAS_URL, getBrowserEditor } from '../../../browserView/electron-browser/browserEditor.js';
import { BrowserEditorZoomSupport } from '../../../browserView/electron-browser/features/browserEditorZoomFeature.js';
import '../../../browserView/electron-browser/features/browserNavigationFeatures.js';

suite('ShortestPath browser actions', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const sandbox = sinon.createSandbox();
	teardown(() => sandbox.restore());

	function setup() {
		const instantiation = workbenchInstantiationService(undefined, store);
		const group = new TestEditorGroupView(1);
		const browser = store.add(instantiation.createInstance(BrowserEditor, group));
		const browserInput = store.add(instantiation.createInstance(BrowserEditorInput, { id: 'problem', url: 'https://example.com/problem' }, async () => { throw new Error('No model resolution expected'); }));
		const source = store.add(new TestFileEditorInput(URI.file('/problem.cpp'), 'test.file'));
		const pair = store.add(instantiation.createInstance(BrowserSourceEditorInput, browserInput, source, undefined));
		const pane = store.add(instantiation.createInstance(SideBySideEditor, group));
		sandbox.stub(pane, 'input').get(() => pair);
		sandbox.stub(pane, 'getSecondaryEditorPane').returns(browser);
		instantiation.stub(IEditorService, 'activeEditorPane', pane);
		return { instantiation, browser, pane };
	}

	test('enables reload and zoom only in the browser scope of a source/problem pair', () => {
		const root = store.add(new ContextKeyService(new TestConfigurationService()));
		root.createKey('activeEditor', SIDE_BY_SIDE_EDITOR_ID);
		const browserContext = store.add(root.createScoped(document.createElement('div')));
		CONTEXT_BROWSER_FOCUSED.bindTo(browserContext);
		CONTEXT_BROWSER_HAS_URL.bindTo(browserContext).set(true);
		const reload = MenuRegistry.getMenuItems(MenuId.BrowserNavigationToolbar).find(item => isIMenuItem(item) && item.command.id === BrowserViewCommandId.Reload);
		assert.ok(reload && isIMenuItem(reload));
		const zoomBindings = ['workbench.action.browser.zoomIn', 'workbench.action.browser.zoomOut'].map(id => {
			const binding = KeybindingsRegistry.getDefaultKeybindings().find(binding => binding.command === id);
			assert.ok(binding);
			return binding;
		});
		assert.deepStrictEqual({
			browserReload: browserContext.contextMatchesRules(reload.command.precondition),
			browserZoom: zoomBindings.map(binding => browserContext.contextMatchesRules(binding.when ?? undefined)),
			standaloneOnlyActions: browserContext.contextMatchesRules(BROWSER_EDITOR_ACTIVE),
			sourceReload: root.contextMatchesRules(reload.command.precondition),
			sourceZoom: zoomBindings.map(binding => root.contextMatchesRules(binding.when ?? undefined)),
		}, { browserReload: true, browserZoom: [true, true], standaloneOnlyActions: false, sourceReload: false, sourceZoom: [false, false] });
		root.createKey('activeEditor', BrowserEditorInput.EDITOR_ID);
		assert.ok(root.contextMatchesRules(BROWSER_EDITOR_ACTIVE));
	});

	test('resolves standalone and paired browser panes without treating a source pane as a browser', () => {
		const { browser, pane } = setup();
		assert.deepStrictEqual([getBrowserEditor(browser), getBrowserEditor(pane), getBrowserEditor(undefined)], [browser, browser, undefined]);
		sandbox.stub(pane, 'getPrimaryEditorPane').returns(browser);
		sandbox.stub(pane, 'input').get(() => undefined);
		assert.strictEqual(getBrowserEditor(pane), undefined);
	});

	test('routes reload, hard reload and zoom commands to the companion browser', async () => {
		const { instantiation, browser } = setup();
		const calls: string[] = [];
		const model = new class extends mock<IBrowserViewModel>() {
			override async reload(hard?: boolean): Promise<void> { calls.push(hard ? 'hardReload' : 'reload'); }
		};
		sandbox.stub(browser, 'model').get(() => model);
		const zoom = new class extends mock<BrowserEditorZoomSupport>() {
			override async zoomIn(): Promise<void> { calls.push('zoomIn'); }
			override async zoomOut(): Promise<void> { calls.push('zoomOut'); }
			override async resetZoom(): Promise<void> { calls.push('resetZoom'); }
		};
		sandbox.stub(browser, 'getContribution').withArgs(BrowserEditorZoomSupport).returns(zoom);
		for (const id of [BrowserViewCommandId.Reload, BrowserViewCommandId.HardReload, 'workbench.action.browser.zoomIn', 'workbench.action.browser.zoomOut', 'workbench.action.browser.resetZoom']) {
			const command = CommandsRegistry.getCommand(id);
			assert.ok(command);
			await instantiation.invokeFunction(accessor => command.handler(accessor));
		}
		assert.deepStrictEqual(calls, ['reload', 'hardReload', 'zoomIn', 'zoomOut', 'resetZoom']);
	});

	test('toolbar targets its own browser when another editor is active', async () => {
		const { instantiation, browser } = setup();
		instantiation.stub(IEditorService, 'activeEditorPane', undefined);
		const reload = sandbox.stub().resolves();
		const model = new class extends mock<IBrowserViewModel>() {
			override reload = reload;
		};
		sandbox.stub(browser, 'model').get(() => model);
		const command = CommandsRegistry.getCommand(BrowserViewCommandId.Reload);
		assert.ok(command);
		await instantiation.invokeFunction(accessor => command.handler(accessor));
		assert.strictEqual(reload.callCount, 0);
		await instantiation.invokeFunction(accessor => command.handler(accessor, browser));
		assert.strictEqual(reload.callCount, 1);
	});
});
