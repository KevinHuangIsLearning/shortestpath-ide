/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { PaneCompositeBar } from '../../../browser/parts/paneCompositeBar.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';

suite('ShortestPath activity container visibility', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	test('integrated SP tests override the default CPH pin and restore it for other sources', () => {
		let integrated = false;
		const bar = Object.create(PaneCompositeBar.prototype) as {
			options: { pinnedViewContainersKey: string };
			contextKeyService: { getContextKeyValue(key: string): boolean };
			shouldBeHidden(container: { id: string }): boolean;
		};
		bar.options = { pinnedViewContainersKey: 'workbench.activity.pinnedViewlets2' };
		bar.contextKeyService = { getContextKeyValue: key => key === 'shortestpath.oj.integratedLocalTests' && integrated };
		const cph = { id: 'workbench.view.extension.cph-judge-view-container' };
		assert.strictEqual(bar.shouldBeHidden(cph), false);
		integrated = true;
		assert.strictEqual(bar.shouldBeHidden(cph), true);
		assert.strictEqual(bar.shouldBeHidden({ id: 'workbench.view.explorer' }), false);
		integrated = false;
		assert.strictEqual(bar.shouldBeHidden(cph), false);
	});
});
