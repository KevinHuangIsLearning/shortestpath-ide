/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *---------------------------------------------------------------------------------------------
 *  Modifications Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { canOpenEditorsInNewWindow, EditorInputCapabilities } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { ShortestPathNewTabInput } from '../../browser/shortestPathNewTabInput.js';

suite('ShortestPathNewTabInput', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('cannot open in another window but remains duplicable', () => {
		const input = disposables.add(new ShortestPathNewTabInput());
		const regularInput = { hasCapability: () => false } as unknown as EditorInput;

		assert.strictEqual(input.hasCapability(EditorInputCapabilities.NoNewWindow), true);
		assert.strictEqual(input.hasCapability(EditorInputCapabilities.Singleton), false);
		assert.strictEqual(canOpenEditorsInNewWindow([regularInput]), true);
		assert.strictEqual(canOpenEditorsInNewWindow([regularInput, input]), false);
	});
});
