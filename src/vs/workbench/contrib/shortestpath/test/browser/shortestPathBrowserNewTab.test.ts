/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { createShortestPathBrowserNewTab } from '../../browser/shortestPathBrowserNewTab.js';
import { shortestPathHome } from '../../common/shortestPathMode.js';

suite('ShortestPath browser New Tab', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('OJ topic shortcut navigates the current tab without a duplicate address field', () => {
		const listeners = store.add(new DisposableStore());
		const navigations: string[] = [];
		const page = createShortestPathBrowserNewTab(listeners, url => navigations.push(url));
		const shortcut = page.querySelector<HTMLButtonElement>('.shortestpath-browser-new-tab-shortcut')!;
		shortcut.click();
		listeners.dispose();
		shortcut.click();
		assert.deepStrictEqual({ navigations, addressFields: page.querySelectorAll('form, input').length, label: !!shortcut.querySelector('.shortestpath-browser-new-tab-shortcut-title') }, { navigations: [shortestPathHome], addressFields: 0, label: true });
	});
});
