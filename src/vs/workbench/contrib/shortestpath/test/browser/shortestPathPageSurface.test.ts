/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../../browser/media/shortestPathMode.css';
import '../../../../browser/media/floatingPanels.css';
import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { OverlayLayoutElement } from '../../../../../base/browser/overlayLayoutElement.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('ShortestPath standalone page surface', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('page content keeps the browser perimeter when compact layout is applied', () => {
		const workbench = append(mainWindow.document.body, $('.monaco-workbench.shortestpath-dual-mode.floating-panels.shortestpath-page-mode'));
		store.add(toDisposable(() => workbench.remove()));
		workbench.style.setProperty('--vscode-cornerRadius-xLarge', '12px');
		const browser = append(workbench, $('.shortestpath-browser-space'));
		const page = append(workbench, $('.shortestpath-page-space'));
		const overlay = store.add(new OverlayLayoutElement());
		append(workbench, overlay.root);
		overlay.content.classList.add('webview-overlay-content', 'shortestpath-page-webview');
		overlay.setAnchorElement(page);
		append(overlay.content, $('iframe'));

		const styles = () => {
			const content = mainWindow.getComputedStyle(overlay.content);
			return {
				browser: mainWindow.getComputedStyle(browser).borderRadius,
				page: mainWindow.getComputedStyle(page).borderRadius,
				content: content.borderRadius,
				overflow: content.overflow,
			};
		};
		const before = styles();
		workbench.classList.add('modern-ui-compact');
		const compact = styles();
		workbench.classList.remove('shortestpath-page-mode');
		workbench.classList.add('shortestpath-page-mode');
		assert.deepStrictEqual([before, compact, styles()], Array(3).fill({ browser: '12px', page: '12px', content: '12px', overflow: 'hidden' }));
	});
});
