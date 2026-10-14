/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { timeout } from '../../../../../base/common/async.js';
import { Emitter } from '../../../../../base/common/event.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { EditorOption } from '../../../../../editor/common/config/editorOptions.js';
import { ILanguageService } from '../../../../../editor/common/languages/language.js';
import { CodeActionController } from '../../../../../editor/contrib/codeAction/browser/codeActionController.js';
import '../../../../../editor/contrib/codeAction/browser/codeActionContributions.js';
import { IActionWidgetService } from '../../../../../platform/actionWidget/browser/actionWidget.js';
import { CommandsRegistry } from '../../../../../platform/commands/common/commands.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ExtensionIdentifier } from '../../../../../platform/extensions/common/extensions.js';
import { IUserInteractionService, MockUserInteractionService } from '../../../../../platform/userInteraction/browser/userInteractionService.js';
import { workbenchInstantiationService } from '../../../../test/browser/workbenchTestServices.js';
import { IOverlayWebview, IWebviewService } from '../../../webview/browser/webview.js';
import '../../browser/shortestPathTemplateEditor.js';

suite('ShortestPath template editor', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();
	const key = 'judger.language.cpp.Template';

	function setup(source = 'int main() {}', viewType = 'shortestpath.settings') {
		let close = () => { };
		store.add(toDisposable(() => close()));
		const writes: string[] = [];
		const configuration = new class extends TestConfigurationService {
			override async updateValue(setting: string, value: string): Promise<void> {
				assert.strictEqual(setting, key);
				writes.push(value);
				await this.setUserConfiguration(setting, value);
			}
		}({ [key]: source, editor: { fontFamily: 'monospace', fontSize: 18, fontLigatures: true, tabSize: 4, insertSpaces: true, detectIndentation: false } });
		const instantiation = workbenchInstantiationService({ configurationService: () => configuration }, store);
		instantiation.stub(IUserInteractionService, new MockUserInteractionService(false));
		instantiation.stub(IActionWidgetService, { hide() { } });
		store.add(configuration.onDidChangeConfigurationEmitter);
		store.add(instantiation.get(ILanguageService).registerLanguage({ id: 'cpp' }));
		const container = append(mainWindow.document.body, $('.monaco-workbench'));
		Object.assign(container.style, { position: 'absolute', width: '800px', height: '600px' });
		store.add(toDisposable(() => container.remove()));
		const disposed = store.add(new Emitter<void>());
		close = () => disposed.fire();
		const messages: object[] = [];
		const webview = new class extends mock<IOverlayWebview>() {
			override readonly container = container;
			override readonly providedViewType = viewType;
			override readonly extension = { id: new ExtensionIdentifier('shortestpath.shortestpath-setup') };
			override readonly onDidDispose = disposed.event;
			override async postMessage(message: object): Promise<boolean> { messages.push(message); return true; }
		}();
		instantiation.stub(IWebviewService, { webviews: [webview] });
		const layout = (overrides = {}) => instantiation.invokeFunction(CommandsRegistry.getCommand('_shortestpath.layoutTemplateEditor')!.handler,
			{ left: 20, top: 40, width: 600, height: 360, clipTop: 100, clipBottom: 400, ...overrides }, 'fallback', viewType);
		layout();
		const editor = instantiation.get(ICodeEditorService).listCodeEditors().at(-1)!;
		const flush = () => instantiation.invokeFunction(CommandsRegistry.getCommand('_shortestpath.flushTemplateEditor')!.handler, viewType);
		return { container, editor, layout, flush, writes, messages, close: () => disposed.fire(), configuration };
	}

	test('uses the native C++ model, editor preferences and clipped viewport without recreating the editor', () => {
		const { container, editor, layout } = setup();
		const viewport = container.querySelector<HTMLElement>('.shortestpath-template-editor')!;
		assert.ok(CodeActionController.get(editor));
		assert.deepStrictEqual({
			source: editor.getValue(), language: editor.getModel()!.getLanguageId(),
			fontSize: editor.getOption(EditorOption.fontSize), ligatures: editor.getOption(EditorOption.fontLigatures),
			tabSize: editor.getModel()!.getOptions().tabSize,
			top: viewport.style.top, height: viewport.style.height,
			editorTop: (viewport.firstElementChild as HTMLElement).style.top
		}, { source: 'int main() {}', language: 'cpp', fontSize: 18, ligatures: '"liga" on, "calt" on', tabSize: 4, top: '100px', height: '300px', editorTop: '-60px' });
		layout({ width: 0, height: 0 });
		assert.strictEqual(viewport.style.display, 'none');
		layout({ top: 120 });
		assert.strictEqual(viewport.style.display, 'block');
		assert.strictEqual(container.querySelectorAll('.monaco-editor').length, 1);
		assert.strictEqual(editor.getValue(), 'int main() {}');
	});

	test('autosaves empty code and undo, and flushes the final edit when closing', async () => {
		const { editor, writes, close, messages, container } = setup();
		const model = editor.getModel()!;
		editor.pushUndoStop();
		editor.executeEdits('test', [{ range: model.getFullModelRange(), text: '' }]);
		editor.pushUndoStop();
		await timeout(300);
		await model.undo();
		await timeout(300);
		editor.executeEdits('test', [{ range: model.getFullModelRange(), text: '// <script> \u4e2d\u6587\nint main() { return 1; }' }]);
		close();
		await timeout(0);
		assert.deepStrictEqual(writes, ['', 'int main() {}', '// <script> \u4e2d\u6587\nint main() { return 1; }']);
		assert.strictEqual(messages.length, 2);
		assert.strictEqual(container.querySelector('.shortestpath-template-editor'), null);
	});

	test('first-run setup uses the same editor and flushes the latest text before navigating', async () => {
		const { editor, flush, writes } = setup('int main() {}', 'shortestpath.gettingStarted');
		editor.executeEdits('test', [{ range: editor.getModel()!.getFullModelRange(), text: 'int main() { return 3; }' }]);
		const source = await flush();
		assert.deepStrictEqual({ source, writes }, { source: 'int main() { return 3; }', writes: ['int main() { return 3; }'] });
	});
});
