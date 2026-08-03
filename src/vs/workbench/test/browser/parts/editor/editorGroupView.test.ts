/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isEditorMoveAcrossWindows } from '../../../../browser/parts/editor/editorGroupView.js';

suite('EditorGroupView', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('distinguishes editor parts from native windows', () => {
		const mainPart = { windowId: 1 };
		const modalPart = { windowId: 1 };
		const auxiliaryPart = { windowId: 2 };

		assert.strictEqual(isEditorMoveAcrossWindows(mainPart, modalPart), false);
		assert.strictEqual(isEditorMoveAcrossWindows(mainPart, auxiliaryPart), true);
	});
});
