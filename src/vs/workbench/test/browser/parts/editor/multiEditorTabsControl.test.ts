/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { isCurrentEditorGroup } from '../../../../browser/parts/editor/multiEditorTabsControl.js';

suite('MultiEditorTabsControl', () => {
	test('only opens a New Tab for a registered editor group', () => {
		const remainingGroup = { id: 1 };
		const removedGroup = { id: 2 };
		const groups = new Map([[remainingGroup.id, remainingGroup]]);
		const groupsView = { getGroup: (id: number) => groups.get(id) };

		assert.strictEqual(isCurrentEditorGroup(groupsView, remainingGroup), true);
		assert.strictEqual(isCurrentEditorGroup(groupsView, removedGroup), false);
	});
});
