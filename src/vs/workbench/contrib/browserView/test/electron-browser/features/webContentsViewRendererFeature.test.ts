/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { CancellationTokenSource } from '../../../../../../base/common/cancellation.js';
import { DeferredPromise } from '../../../../../../base/common/async.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { DisposableStore, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import { BrowserEditor } from '../../../electron-browser/browserEditor.js';
import { WebContentsViewRendererFeature } from '../../../electron-browser/features/webContentsViewRendererFeature.js';
import { BrowserEditorInput } from '../../../common/browserEditorInput.js';
import { IBrowserViewModel } from '../../../common/browserView.js';

suite('Browser editor mode visibility', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('inert editor ancestors hide native pages and restoring the mode reveals them without reloading', async () => {
		const part = append(mainWindow.document.body, $('.part.editor'));
		store.add(toDisposable(() => part.remove()));
		const container = append(part, $('.browser-container'));
		const changes = store.add(new Emitter<{ model: IBrowserViewModel; isNew: boolean }>());
		const editor = new class extends mock<BrowserEditor>() {
			override readonly onDidChangeModel = changes.event;
			override get window() { return mainWindow; }
		};
		const feature = store.add(new WebContentsViewRendererFeature(editor, new NullLogService(), new class extends mock<IKeybindingService>() { }));
		feature.onContainerCreated(container);
		const visibility: boolean[] = [];
		const model = new class extends mock<IBrowserViewModel>() {
			override visible = false;
			override readonly url = 'https://example.com/problem';
			override readonly onDidChangeVisibility = Event.None;
			override readonly onDidKeyCommand = Event.None;
			override readonly onDidNavigate = Event.None;
			override readonly onDidChangeLoadingState = Event.None;
			override async captureScreenshot() { return VSBuffer.fromString('frame'); }
			override async setVisible(value: boolean) { this.visible = value; visibility.push(value); }
		};
		changes.fire({ model, isNew: false });
		feature.onPaneVisibilityChanged(true);
		part.inert = true;
		await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => mainWindow.requestAnimationFrame(() => resolve())));
		part.inert = false;
		await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
		feature.onPaneVisibilityChanged(false);
		await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
		assert.deepStrictEqual(visibility, [true, false, true, false]);
		feature.onModelDetached();
	});
	function setupScreenshots() {
		const changes = store.add(new Emitter<{ model: IBrowserViewModel | undefined; isNew: boolean }>());
		const editor = new class extends mock<BrowserEditor>() {
			override readonly onDidChangeModel = changes.event;
			override get window() { return mainWindow; }
		};
		const feature = store.add(new WebContentsViewRendererFeature(editor, new NullLogService(), new class extends mock<IKeybindingService>() { }));
		feature.onPaneVisibilityChanged(true);
		const captures: DeferredPromise<VSBuffer>[] = [];
		const loading = store.add(new Emitter<void>());
		const model = new class extends mock<IBrowserViewModel>() {
			override visible = true;
			override url = 'https://example.com/old';
			override readonly onDidChangeVisibility = Event.None;
			override readonly onDidKeyCommand = Event.None;
			override readonly onDidNavigate = Event.None;
			override readonly onDidChangeLoadingState = loading.event;
			override async captureScreenshot() { const capture = new DeferredPromise<VSBuffer>(); captures.push(capture); return capture.p; }
			override async setVisible(value: boolean) { this.visible = value; }
		};
		return { feature, changes, captures, loading, model, screenshot: feature.widgets[0].element };
	}

	async function finishCapture(capture: DeferredPromise<VSBuffer>, frame: string): Promise<void> {
		await capture.complete(VSBuffer.fromString(frame));
		// captureScreenshot adopts the deferred promise before the renderer's await
		// resumes. Wait for that whole chain, rather than asserting before it ran.
		await new Promise<void>(resolve => mainWindow.setTimeout(resolve, 0));
	}

	test('a delayed old-tab screenshot cannot reappear while the next tab resolves', async () => {
		const { changes, captures, model, screenshot } = setupScreenshots();
		changes.fire({ model, isNew: false });
		changes.fire({ model: undefined, isNew: true });
		await finishCapture(captures[0], 'old page');
		assert.deepStrictEqual({ background: screenshot.style.backgroundImage, display: screenshot.style.display, oldVisible: model.visible }, { background: '', display: 'none', oldVisible: false });
	});

	test('a delayed old-tab screenshot cannot replace the new tab screenshot', async () => {
		const { changes, captures, model, screenshot } = setupScreenshots();
		changes.fire({ model, isNew: false });
		const next = new class extends mock<IBrowserViewModel>() {
			override visible = true;
			override readonly url = 'https://example.com/new';
			override readonly onDidChangeVisibility = Event.None;
			override readonly onDidKeyCommand = Event.None;
			override readonly onDidNavigate = Event.None;
			override readonly onDidChangeLoadingState = Event.None;
			override async captureScreenshot() { return VSBuffer.fromString('new page'); }
			override async setVisible(value: boolean) { this.visible = value; }
		};
		changes.fire({ model: next, isNew: true });
		await Promise.resolve();
		const current = screenshot.style.backgroundImage;
		await finishCapture(captures[0], 'old page');
		assert.ok(current && screenshot.style.backgroundImage === current);
	});

	test('a newer capture wins when screenshots of the same tab finish out of order', async () => {
		const { changes, captures, loading, model, screenshot } = setupScreenshots();
		changes.fire({ model, isNew: false }); loading.fire();
		await finishCapture(captures[1], 'new frame');
		const current = screenshot.style.backgroundImage;
		await finishCapture(captures[0], 'old frame');
		assert.ok(current && screenshot.style.backgroundImage === current);
	});

	test('navigation and disposal invalidate unfinished captures', async () => {
		for (const dispose of [false, true]) {
			const { feature, changes, captures, model, screenshot } = setupScreenshots();
			changes.fire({ model, isNew: false });
			if (dispose) { feature.dispose(); } else { model.url = 'https://example.com/new'; }
			await finishCapture(captures[0], 'old frame');
			assert.strictEqual(screenshot.style.backgroundImage, '');
		}
	});

	test('switching inputs clears the old page before a slow model resolve completes', async () => {
		const { changes, captures, model, screenshot } = setupScreenshots();
		changes.fire({ model, isNew: false });
		const started = new DeferredPromise<void>();
		const resolving = new DeferredPromise<IBrowserViewModel>();
		const token = store.add(new CancellationTokenSource());
		const input = new class extends mock<BrowserEditorInput>() {
			override get model() { return undefined; }
			override readonly url = 'https://example.com/new';
			override async resolve() { started.complete(); return resolving.p; }
		};
		const pane = Object.assign(Object.create(BrowserEditor.prototype), {
			group: { windowId: mainWindow.vscodeWindowId },
			_model: model,
			_onDidChangeModel: changes,
			_inputDisposables: store.add(new DisposableStore()),
			_hasUrlContext: { set: () => { } }, _hasErrorContext: { set: () => { } },
			_contributionInstances: new Map(),
		}) as BrowserEditor;
		const switching = pane.setInput(input, undefined, { newInGroup: true }, token.token);
		await started.p;
		await finishCapture(captures[0], 'old page');
		const pending = { detached: pane.model === undefined, visible: model.visible, background: screenshot.style.backgroundImage };
		token.cancel(); await resolving.complete(model); await switching;
		assert.deepStrictEqual({ ...pending, cancelled: pane.model === undefined }, { detached: true, visible: false, background: '', cancelled: true });
	});

});
