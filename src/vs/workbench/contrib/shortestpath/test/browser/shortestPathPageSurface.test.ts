/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
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

	test('browsing preserves modal settings headers, controls and modal webviews', () => {
		const workbench = append(mainWindow.document.body, $('.monaco-workbench.shortestpath-dual-mode.shortestpath-browsing'));
		store.add(toDisposable(() => workbench.remove()));
		const workspaceEditor = append(workbench, $('.part.editor'));
		const browserEditor = append(workbench, $('.part.editor.embedded-editor-part'));
		const modal = append(workbench, $('.monaco-modal-editor-block'));
		const modalEditor = append(modal, $('.part.editor.modal-editor-part'));
		const header = append(modalEditor, $('.modal-editor-header'));
		const close = append(header, $('button.modal-editor-close'));
		const content = append(modalEditor, $('.content'));
		const workspaceOverlay = append(workbench, $('.webview-overlay-content'));
		workspaceOverlay.style.visibility = 'visible';
		const workspaceWebview = append(workspaceOverlay, $('iframe.webview'));
		const modalOverlay = append(workbench, $('.webview-overlay-content.webview-overlay-modal'));
		modalOverlay.style.visibility = 'visible';
		const modalWebview = append(modalOverlay, $('iframe.webview'));

		assert.deepStrictEqual(
			[workspaceEditor, browserEditor, modalEditor, header, close, content, workspaceWebview, modalWebview].map(element => mainWindow.getComputedStyle(element).visibility),
			['hidden', 'visible', 'visible', 'visible', 'visible', 'visible', 'hidden', 'visible']
		);
	});

	test('page content keeps the browser perimeter when compact layout is applied', () => {
		const workbench = append(mainWindow.document.body, $('.monaco-workbench.shortestpath-dual-mode.floating-panels.shortestpath-page-mode'));
		store.add(toDisposable(() => workbench.remove()));
		workbench.style.setProperty('--vscode-cornerRadius-xLarge', '12px');
		const browser = append(workbench, $('.shortestpath-browser-space.part.editor.embedded-editor-part'));
		const browserContent = append(browser, $('.content'));
		append(browserContent, $('.shortestpath-browser-new-tab'));
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
				browserContent: mainWindow.getComputedStyle(browserContent).borderRadius,
			browserOverflow: mainWindow.getComputedStyle(browser).overflow,
			browserContentOverflow: mainWindow.getComputedStyle(browserContent).overflow,
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
		assert.deepStrictEqual([before, compact, styles()], Array(3).fill({ browser: '12px', browserContent: '12px', browserOverflow: 'hidden', browserContentOverflow: 'hidden', page: '12px', content: '12px', overflow: 'hidden' }));
	});
});
