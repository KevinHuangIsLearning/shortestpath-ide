/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Dimension } from '../../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { SideBySideEditor } from '../../../../browser/parts/editor/sideBySideEditor.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { SideBySideEditor as Side, IUntypedEditorInput, IVisibleEditorPane } from '../../../../common/editor.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { WebviewEditorService } from '../../../../contrib/webviewPanel/browser/webviewWorkbenchService.js';
import { IEditorReplacement } from '../../../../services/editor/common/editorGroupsService.js';
import { ITextEditorService } from '../../../../services/textfile/common/textEditorService.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { RunSourceAction } from '../../../../contrib/shortestpath/browser/problemEditorActions.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { BrowserSourceEditorInput } from '../../../../contrib/browserView/common/browserSourceEditorInput.js';
import { WebviewSourceEditorInput } from '../../../../contrib/webviewPanel/browser/webviewSourceEditorInput.js';
import { WebviewInput } from '../../../../contrib/webviewPanel/browser/webviewEditorInput.js';
import { TestEditorGroupView, TestFileEditorInput, workbenchInstantiationService } from '../../workbenchTestServices.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';

suite('WebviewSourceEditorInput', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	class SourceInput extends EditorInput {
		constructor(private readonly uri = URI.file('/problem.cpp')) { super(); }
		nextSaveAs: IUntypedEditorInput | undefined;
		override async rename(_group: number, target: URI) { return { editor: { resource: target } }; }
		override get typeId(): string { return 'test.source'; }
		override get resource(): URI { return this.uri; }
		override getName(): string { return 'problem.cpp'; }
		dirty = false;
		override isDirty(): boolean { return this.dirty; }
		override async save(): Promise<EditorInput> { this.dirty = false; return this; }
		override async saveAs(): Promise<EditorInput | IUntypedEditorInput> { return this.nextSaveAs ?? this; }
		change(): void { this.dirty = true; this._onDidChangeDirty.fire(); }
	}

	function pair(ratio?: number) {
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(ITextEditorService, { resolveTextEditor: async (input: IUntypedEditorInput) => store.add(new TestFileEditorInput((input as { resource: URI }).resource, 'test.source')) });
		const source = store.add(new SourceInput());
		const companion = store.add(new SourceInput());
		const input = store.add(instantiationService.createInstance(WebviewSourceEditorInput, companion as unknown as WebviewInput, source, ratio));
		return { source, companion, input };
	}

	test('source owns the resource, dirty state and saves without separating the pair', async () => {
		const { source, input } = pair();
		let changes = 0;
		store.add(input.onDidChangeDirty(() => changes++));
		source.change();
		assert.strictEqual(changes, 1);
		assert.strictEqual(input.isDirty(), true);
		assert.strictEqual(input.resource?.toString(), source.resource.toString());
		assert.strictEqual(input.getName(), 'problem.cpp');
		assert.strictEqual(await input.save(1), input);
		assert.strictEqual(input.isDirty(), false);
		assert.strictEqual(await input.saveAs(1), input);
	});

	test('disposing either child invalidates the single composite input', () => {
		const { companion, input } = pair();
		companion.dispose();
		assert.strictEqual(input.isDisposed(), true);
		const second = pair();
		second.source.dispose();
		assert.strictEqual(second.input.isDisposed(), true);
	});

	test('save as and rename preserve the companion with a new native source URI', async () => {
		const { source, companion, input } = pair(75);
		source.nextSaveAs = { resource: URI.file('/saved.cpp') };
		const saved = store.add(await input.saveAs(1) as WebviewSourceEditorInput);
		assert.ok(saved instanceof WebviewSourceEditorInput);
		assert.strictEqual(saved.secondary, companion);
		assert.strictEqual(saved.resource?.path, '/saved.cpp');
		assert.strictEqual(saved.initialSplitRatio, 0.75);
		const move = await input.rename(1, URI.file('/renamed.cpp'));
		const renamed = store.add(move!.editor as WebviewSourceEditorInput);
		assert.ok(renamed instanceof WebviewSourceEditorInput);
		assert.strictEqual(renamed.secondary, companion);
		assert.strictEqual(renamed.resource?.path, '/renamed.cpp');
		assert.strictEqual(renamed.viewStateResource?.path, '/renamed.cpp');
	});

	test('browser pair keeps its companion and ratio through saving and renaming the source', async () => {
		const instantiation = workbenchInstantiationService(undefined, store);
		instantiation.stub(ITextEditorService, { resolveTextEditor: async (input: IUntypedEditorInput) => store.add(new TestFileEditorInput((input as { resource: URI }).resource, 'test.source')) });
		const source = store.add(new SourceInput());
		const browser = store.add(new SourceInput(URI.parse('vscode-browser:/test')));
		const input = store.add(instantiation.createInstance(BrowserSourceEditorInput, browser, source, 65));
		source.change();
		assert.strictEqual(input.isDirty(), true);
		assert.strictEqual(await input.save(1), input);
		source.nextSaveAs = { resource: URI.file('/saved.cpp') };
		const saved = store.add(await input.saveAs(1) as BrowserSourceEditorInput);
		const moved = store.add((await input.rename(1, URI.file('/moved.cpp')))!.editor as BrowserSourceEditorInput);
		assert.deepStrictEqual([saved, moved].map(pair => ({
			browserPair: pair instanceof BrowserSourceEditorInput, companion: pair.secondary === browser,
			path: pair.resource?.path, ratio: pair.initialSplitRatio, reveal: pair.revealOnPrimaryOpen,
		})), [
			{ browserPair: true, companion: true, path: '/saved.cpp', ratio: 0.65, reveal: true },
			{ browserPair: true, companion: true, path: '/moved.cpp', ratio: 0.65, reveal: true },
		]);
	});

	test('extension disposal preserves an unsaved source in a native tab', async () => {
		const { source, companion, input } = pair();
		source.change();
		let replaced = false;
		const group = {
			editors: [input],
			async replaceEditors(replacements: IEditorReplacement[]) {
				assert.strictEqual(replacements[0].replacement, source);
				assert.strictEqual(replacements[0].forceReplaceDirty, true);
				replaced = true;
				input.dispose();
			},
		};
		const controller = Object.assign(Object.create(WebviewEditorService.prototype), {
			editorGroupsService: { groups: [group] },
		}) as WebviewEditorService;
		await controller.disposeWebview(companion as unknown as WebviewInput);
		assert.strictEqual(replaced, true);
		assert.strictEqual(companion.isDisposed(), true);
		assert.strictEqual(source.isDisposed(), false);
		assert.strictEqual(source.isDirty(), true);
	});

	test('native pane keeps source view state, companion focus and an equal dragged split', async () => {
		const { input } = pair();
		const instantiationService = workbenchInstantiationService(undefined, store);
		const pane = store.add(instantiationService.createInstance(SideBySideEditor, new TestEditorGroupView(1)));
		await EditorPane.prototype.setInput.call(pane, input, undefined, { newInGroup: true }, CancellationToken.None);
		pane.create(document.createElement('div'));
		pane.layout(new Dimension(1000, 600));
		Object.assign(pane, {
			primaryEditorPane: { getViewState: () => ({ cursor: 42, scrollTop: 300 }) },
			secondaryEditorPane: { getViewState: () => undefined, setVisible: () => { }, layout: () => { }, setInput: async () => { } },
			lastFocusedSide: Side.SECONDARY,
		});
		assert.deepStrictEqual(pane.getViewState(), {
			primary: { cursor: 42, scrollTop: 300 }, secondary: {}, focus: Side.SECONDARY, ratio: 0.5,
		});
		assert.strictEqual(input.viewStateResource, input.primary.resource);
	});

	test('opening a source location forwards its native view state to the primary pane', async () => {
		const { input } = pair();
		const instantiationService = workbenchInstantiationService(undefined, store);
		const pane = store.add(instantiationService.createInstance(SideBySideEditor, new TestEditorGroupView(1)));
		await EditorPane.prototype.setInput.call(pane, input, undefined, { newInGroup: true }, CancellationToken.None);
		pane.create(document.createElement('div'));
		let primaryOptions: IEditorOptions | undefined;
		Object.assign(pane, {
			primaryEditorPane: { layout: () => { }, setInput: async (_input: EditorInput, options: IEditorOptions) => { primaryOptions = options; } },
			secondaryEditorPane: { setVisible: () => { }, layout: () => { }, setInput: async () => { } },
		});
		const viewState = { cursor: 42, scrollTop: 300 };
		await pane.setInput(input, { target: Side.PRIMARY, viewState }, { newInGroup: false }, CancellationToken.None);
		assert.deepStrictEqual(primaryOptions?.viewState, viewState);
	});

	test('collapsing the companion keeps its split ratio across resize and restores the source focus', async () => {
		const { input, source, companion } = pair();
		const instantiationService = workbenchInstantiationService(undefined, store);
		const pane = store.add(instantiationService.createInstance(SideBySideEditor, new TestEditorGroupView(1)));
		await EditorPane.prototype.setInput.call(pane, input, undefined, { newInGroup: true }, CancellationToken.None);
		pane.create(document.createElement('div'));
		pane.layout(new Dimension(1000, 600));
		Object.assign(pane, {
			primaryEditorPane: { getViewState: () => ({ cursor: 42 }), layout: () => { }, setInput: async () => { } },
			secondaryEditorPane: { getViewState: () => undefined, setVisible: () => { }, layout: () => { }, setInput: async () => { } },
			lastFocusedSide: Side.SECONDARY,
		});
		pane.setSecondaryVisible(false);
		pane.layout(new Dimension(1600, 600));
		assert.deepStrictEqual({ state: pane.getViewState(), visible: pane.isSecondaryVisible, sourceDisposed: source.isDisposed(), companionDisposed: companion.isDisposed() }, {
			state: { primary: { cursor: 42 }, secondary: {}, focus: Side.PRIMARY, ratio: 0.5, secondaryHidden: true },
			visible: false, sourceDisposed: false, companionDisposed: false,
		});
		const collapsedState = pane.getViewState();
		pane.setSecondaryVisible(true);
		assert.deepStrictEqual({ state: pane.getViewState(), visible: pane.isSecondaryVisible }, {
			state: { primary: { cursor: 42 }, secondary: {}, focus: Side.PRIMARY, ratio: 0.5 }, visible: true,
		});
		await pane.setInput(input, { viewState: collapsedState }, { newInGroup: false }, CancellationToken.None);
		assert.deepStrictEqual({ state: pane.getViewState(), visible: pane.isSecondaryVisible }, { state: collapsedState, visible: false });
	});

	test('running while the companion has focus targets the source before invoking the extension', async () => {
		const { input } = pair();
		const instantiationService = workbenchInstantiationService(undefined, store);
		const pane = store.add(instantiationService.createInstance(SideBySideEditor, new TestEditorGroupView(1)));
		await EditorPane.prototype.setInput.call(pane, input, undefined, { newInGroup: true }, CancellationToken.None);
		let focused = 'companion';
		Object.assign(pane, {
			primaryEditorPane: { setOptions: () => { }, focus: () => { focused = 'source'; } },
			secondaryEditorPane: { setOptions: () => { }, focus: () => { focused = 'companion'; } },
			lastFocusedSide: Side.SECONDARY,
		});
		let invoked: object | undefined;
		instantiationService.stub(IEditorService, { activeEditorPane: pane as IVisibleEditorPane });
		instantiationService.stub(ICommandService, { executeCommand: async (command: string) => { invoked = { command, focused }; } });
		await instantiationService.invokeFunction(accessor => new RunSourceAction().run(accessor));
		assert.deepStrictEqual(invoked, { command: 'extension.CompileRun', focused: 'source' });
	});

	test('source stays on the left with a bounded horizontal split', () => {
		assert.strictEqual(pair().input.initialSplitRatio, 0.6);
		assert.strictEqual(pair(75).input.initialSplitRatio, 0.75);
		assert.strictEqual(pair(NaN).input.initialSplitRatio, 0.6);
		assert.strictEqual(pair(1).input.initialSplitRatio, 0.1);
		assert.strictEqual(pair(100).input.initialSplitRatio, 0.9);
		assert.strictEqual(pair().input.primaryOnLeft, true);
		assert.strictEqual(pair().input.forceHorizontalLayout, true);
		assert.strictEqual(pair().input.revealOnPrimaryOpen, true);
	});
});
