/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { toDisposable } from '../../../../../../base/common/lifecycle.js';
import { mock } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { NullLogService } from '../../../../../../platform/log/common/log.js';
import { BrowserEditor } from '../../../electron-browser/browserEditor.js';
import { WebContentsViewRendererFeature } from '../../../electron-browser/features/webContentsViewRendererFeature.js';
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
});
