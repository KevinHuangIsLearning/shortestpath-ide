/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../../browser/media/shortestPathMode.css';
import '../../../../browser/media/floatingPanels.css';
import '../../../../browser/parts/titlebar/media/titlebarpart.css';
import assert from 'assert';
import { $, append } from '../../../../../base/browser/dom.js';
import { registerNavigationExpansion, registerNavigationSwipe } from '../../browser/shortestPathNavigationSwipe.js';
import { OverlayLayoutElement } from '../../../../../base/browser/overlayLayoutElement.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';

suite('ShortestPath standalone page surface', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('navigation button backgrounds have equal gutters to the window and standalone content', () => {
		const workbench = append(mainWindow.document.body, $('.monaco-workbench.shortestpath-dual-mode'));
		store.add(toDisposable(() => workbench.remove()));
		workbench.style.cssText = 'position:relative;width:600px;height:400px';
		const navigation = append(workbench, $('.workbench-navigation'));
		navigation.style.cssText = 'width:48px;height:400px';
		const buttons = ['shortestpath-mode-switch', 'shortestpath-navigation-actions'].map(className => {
			const group = append(navigation, $(`.${className}`));
			const button = append(group, $('button'));
			append(button, $('span.codicon.codicon-settings-gear'));
			return button;
		});
		for (const className of ['shortestpath-browser-space', 'shortestpath-page-space']) {
			const content = append(workbench, $(`.${className}`));
			content.style.left = '48px';
			const left = workbench.getBoundingClientRect().left;
			const right = content.getBoundingClientRect().left;
			for (const button of buttons) {
				const bounds = button.getBoundingClientRect();
				assert.deepStrictEqual({ left: bounds.left - left, right: right - bounds.right, width: bounds.width }, { left: 8, right: 8, width: 36 });
			}
			content.remove();
		}
	});

	for (const platform of ['mac', 'windows']) {
		test(`Compact Mode centers Command Center on the entire ${platform} window`, () => {
			const workbench = append(mainWindow.document.body, $(`.monaco-workbench.${platform}.shortestpath-dual-mode.shortestpath-compact-mode`));
			store.add(toDisposable(() => workbench.remove()));
			workbench.style.cssText = 'position:relative;width:1200px;height:400px';
			workbench.style.setProperty('--vscode-titleBar-activeBackground', '#303030');
			workbench.style.setProperty('--vscode-titleBar-inactiveBackground', '#404040');
			const titlebar = append(workbench, $('.part.titlebar'));
			titlebar.style.cssText = 'width:1200px;height:35px';
			const container = append(titlebar, $('.titlebar-container.has-center'));
			const left = append(container, $('.titlebar-left'));
			const controls = platform === 'mac' ? append(left, $('.window-controls-container')) : undefined;
			const host = append(left, $('.titlebar-navigation-container'));
			const navigation = append(host, $('.workbench-navigation.compact-navigation'));
			const group = append(navigation, $('.shortestpath-mode-switch'));
			const buttons = Array.from({ length: 6 }, () => {
				const button = append(group, $('button'));
				append(button, $('svg.shortestpath-mode-icon'));
				return button;
			});
			buttons[0].setAttribute('aria-pressed', 'true');
			buttons[0].focus();
			const center = append(container, $('.titlebar-center'));
			const windowTitle = append(center, $('.window-title'));
			const commandCenter = append(windowTitle, $('.command-center'));
			const centerTitle = append(commandCenter, $('.action-item.command-center-center', undefined, 'Workspace'));
			const right = append(container, $('.titlebar-right'));
			if (platform === 'windows') { append(right, $('.window-controls-container')); }
			assert.strictEqual(mainWindow.getComputedStyle(right).flexGrow, '1');
			assert.strictEqual(mainWindow.getComputedStyle(left).flexGrow, '1');
			assert.strictEqual(mainWindow.getComputedStyle(center).flexGrow, '0');
			assert.ok(buttons[0].getBoundingClientRect().left >= (controls ?? left).getBoundingClientRect().left);
			if (controls) { assert.ok(buttons[0].getBoundingClientRect().left >= controls.getBoundingClientRect().right); }
			assert.ok(buttons[5].getBoundingClientRect().right <= center.getBoundingClientRect().left);
			assert.strictEqual(navigation.scrollWidth, navigation.clientWidth);
			assert.strictEqual(navigation.getBoundingClientRect().height, centerTitle.getBoundingClientRect().height);
			assert.ok(buttons.every(button => button.getBoundingClientRect().height === 22));
			assert.ok(Math.abs(navigation.getBoundingClientRect().top - centerTitle.getBoundingClientRect().top) < 1);
			for (const width of [600, 800, 1200]) {
				workbench.style.width = titlebar.style.width = `${width}px`;
				centerTitle.style.width = `${Math.min(width * .38, 600)}px`;
				const bounds = center.getBoundingClientRect();
				const windowBounds = titlebar.getBoundingClientRect();
				assert.ok(Math.abs(bounds.left + bounds.width / 2 - windowBounds.left - windowBounds.width / 2) < 1);
			}
			workbench.style.width = titlebar.style.width = '600px';
			centerTitle.style.width = '228px';
			for (const button of buttons) { button.style.width = '70px'; }
			const navigationBounds = navigation.getBoundingClientRect();
			const centerBounds = centerTitle.getBoundingClientRect();
			assert.ok(navigationBounds.right > centerBounds.left);
			assert.strictEqual(navigation.scrollWidth, navigation.clientWidth);
			assert.ok(buttons.every(button => button.getBoundingClientRect().width === 70));
			assert.notStrictEqual(mainWindow.getComputedStyle(navigation).boxShadow, 'none');
			assert.strictEqual(mainWindow.getComputedStyle(navigation).backgroundColor, 'rgb(48, 48, 48)');
			titlebar.classList.add('inactive');
			assert.strictEqual(mainWindow.getComputedStyle(navigation).backgroundColor, 'rgb(64, 64, 64)');
			const covered = mainWindow.document.elementFromPoint(centerBounds.left + 8, centerBounds.top + centerBounds.height / 2);
			assert.ok(covered && navigation.contains(covered));
			assert.deepStrictEqual(buttons.map(button => button.getBoundingClientRect().top), Array(6).fill(buttons[0].getBoundingClientRect().top));
		});
	}

	test('Compact Mode shows only the active page and expands for keyboard focus', () => {
		const workbench = append(mainWindow.document.body, $('.monaco-workbench.shortestpath-dual-mode'));
		store.add(toDisposable(() => workbench.remove()));
		const navigation = append(workbench, $('.workbench-navigation.compact-navigation'));
		const modes = append(navigation, $('.shortestpath-mode-switch'));
		const browse = append(modes, $('button', { 'aria-pressed': 'true' }));
		const solve = append(modes, $('button', { 'aria-pressed': 'false' }));
		const actions = append(navigation, $('.shortestpath-navigation-actions'));
		const settings = append(actions, $('button', { 'aria-pressed': 'false' }));
		const visible = (element: HTMLElement) => element.getBoundingClientRect().width > 0;
		assert.deepStrictEqual([browse, solve, settings].map(visible), [true, false, false]);
		browse.focus();
		assert.deepStrictEqual([browse, solve, settings].map(visible), [true, true, true]);
		browse.blur();
		browse.setAttribute('aria-pressed', 'false');
		settings.setAttribute('aria-pressed', 'true');
		assert.deepStrictEqual([browse, solve, settings].map(visible), [false, false, true]);
	});

	test('Compact Mode animates group width and labels the active page', async () => {
		const waitForLayout = async () => {
			for (let frame = 0; frame < 3; frame++) {
				await new Promise<void>(resolve => mainWindow.requestAnimationFrame(() => resolve()));
			}
		};
		const workbench = append(mainWindow.document.body, $('.monaco-workbench.shortestpath-dual-mode'));
		store.add(toDisposable(() => workbench.remove()));
		const navigation = append(workbench, $('.workbench-navigation.compact-navigation'));
		append(navigation, $('button.shortestpath-navigation-hint'));
		const modes = append(navigation, $('.shortestpath-mode-switch'));
		const browse = append(modes, $<HTMLButtonElement>('button', { 'aria-pressed': 'true', 'aria-label': 'Browse' }));
		append(browse, $('svg.shortestpath-mode-icon'));
		const solve = append(modes, $<HTMLButtonElement>('button', { 'aria-pressed': 'false', 'aria-label': 'Solve' }));
		append(solve, $('svg.shortestpath-mode-icon'));
		append(navigation, $('button.shortestpath-navigation-hint.shortestpath-navigation-hint-right'));
		store.add(registerNavigationSwipe(navigation, () => { }, [browse, solve]));
		store.add(registerNavigationExpansion(navigation));
		const collapsedWidth = parseFloat(navigation.style.width);
		assert.strictEqual(mainWindow.getComputedStyle(browse, '::after').content, '"Browse"');
		assert.ok(mainWindow.getComputedStyle(navigation).transitionDuration.includes('0.16s'));
		browse.focus();
		await waitForLayout();
		assert.ok(parseFloat(navigation.style.width) > collapsedWidth);
		const expandedWidth = parseFloat(navigation.style.width);
		// Intrinsic child sizes can change without a focus or attribute event (for example,
		// while loading a font). The group must track the final size by itself.
		solve.style.width = '70px';
		await waitForLayout();
		assert.ok(Math.abs(parseFloat(navigation.style.width) - expandedWidth - 44) < 1);
		browse.blur();
		await waitForLayout();
		assert.strictEqual(parseFloat(navigation.style.width), collapsedWidth);
		for (const zoom of [.8, 1.25]) {
			workbench.style.zoom = String(zoom);
			navigation.classList.toggle('zoom-test');
			await waitForLayout();
			assert.ok(Math.abs(parseFloat(navigation.style.width) - collapsedWidth) < 1);
		}
	});

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

	test('Sketchpad keeps the native sidebar and Activity Bar visible while other standalone pages hide them', () => {
		const workbench = append(mainWindow.document.body, $('.monaco-workbench.shortestpath-dual-mode.shortestpath-page-mode.shortestpath-draw-mode'));
		store.add(toDisposable(() => workbench.remove()));
		const sidebar = append(workbench, $('.part.sidebar'));
		const activitybar = append(workbench, $('.part.activitybar'));
		const editor = append(workbench, $('.part.editor'));
		const page = append(workbench, $('.shortestpath-page-space'));
		const drawing = append(page, $('.shortestpath-drawing-space.part.editor.embedded-editor-part'));
		const drawingOverlay = append(workbench, $('.webview-overlay-content.shortestpath-draw-webview'));
		const companionOverlay = append(workbench, $('.webview-overlay-content'));
		assert.deepStrictEqual([drawing, drawingOverlay, companionOverlay].map(element => mainWindow.getComputedStyle(element).visibility), ['visible', 'visible', 'hidden']);
		const visibility = () => [sidebar, activitybar, editor].map(element => mainWindow.getComputedStyle(element).visibility);
		assert.deepStrictEqual(visibility(), ['visible', 'visible', 'hidden']);
		workbench.classList.remove('shortestpath-draw-mode');
		assert.deepStrictEqual(visibility(), ['hidden', 'hidden', 'hidden']);
		assert.strictEqual(mainWindow.getComputedStyle(page).visibility, 'visible');
		assert.strictEqual(mainWindow.getComputedStyle(drawing).visibility, 'hidden');
	});

	test('Sketchpad rounds the workspace perimeter while keeping sidebar and tab seams square', () => {
		const workbench = append(mainWindow.document.body, $('.monaco-workbench.shortestpath-dual-mode.shortestpath-page-mode.shortestpath-draw-mode'));
		store.add(toDisposable(() => workbench.remove()));
		workbench.style.setProperty('--vscode-cornerRadius-large', '12px');
		const page = append(workbench, $('.shortestpath-page-space'));
		page.style.borderRadius = '0 12px 12px 0';
		const drawing = append(page, $('.shortestpath-drawing-space.part.editor.embedded-editor-part'));
		const content = append(drawing, $('.content'));
		const overlay = append(workbench, $('.webview-overlay-content.shortestpath-draw-webview.webview-overlay-outer-right.webview-overlay-outer-bottom'));
		assert.strictEqual(mainWindow.getComputedStyle(page).marginLeft, '0px');
		assert.strictEqual(mainWindow.getComputedStyle(page).zIndex, 'auto');
		assert.strictEqual(mainWindow.getComputedStyle(drawing).borderRadius, '0px 12px 12px 0px');
		assert.strictEqual(mainWindow.getComputedStyle(content).borderRadius, '0px 12px 12px 0px');
		assert.strictEqual(mainWindow.getComputedStyle(overlay).borderRadius, '0px 0px 12px');
		overlay.classList.remove('webview-overlay-outer-right');
		overlay.classList.add('webview-overlay-outer-left');
		assert.strictEqual(mainWindow.getComputedStyle(overlay).borderRadius, '0px 0px 0px 12px');
		overlay.classList.add('webview-overlay-outer-right');
		assert.strictEqual(mainWindow.getComputedStyle(overlay).borderRadius, '0px 0px 12px 12px');
	});

	test('Sketchpad canvas stays below the sidebar resize handle at a joined seam', () => {
		const workbench = append(mainWindow.document.body, $('.monaco-workbench.shortestpath-dual-mode.shortestpath-page-mode.shortestpath-draw-mode'));
		store.add(toDisposable(() => workbench.remove()));
		workbench.style.cssText = 'position:relative;width:600px;height:400px;z-index:1';
		const page = append(workbench, $('.shortestpath-page-space'));
		page.style.cssText = 'left:200px;top:35px';
		const drawing = append(page, $('.shortestpath-drawing-space.part.editor.embedded-editor-part'));
		const overlay = store.add(new OverlayLayoutElement());
		append(workbench, overlay.root);
		overlay.content.classList.add('webview-overlay-content', 'shortestpath-draw-webview');
		overlay.setAnchorElement(drawing);
		const sash = append(workbench, $('.monaco-sash.primary-sidebar-sash'));
		sash.style.cssText = 'position:absolute;left:198px;top:35px;width:4px;height:360px;z-index:35';
		const bounds = sash.getBoundingClientRect();
		assert.strictEqual(mainWindow.document.elementFromPoint(bounds.left + 2, bounds.top + 100), sash);
		assert.strictEqual(mainWindow.getComputedStyle(overlay.content).zIndex, '2');
		const canvas = overlay.content.getBoundingClientRect();
		assert.strictEqual(mainWindow.document.elementFromPoint(canvas.left + 20, canvas.top + 100), overlay.content);
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
