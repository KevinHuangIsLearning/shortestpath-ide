/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getWindowMaterial, IWindowMaterialCapabilities } from '../../common/windowMaterial.js';

suite('Window material capability policy', () => {
	ensureNoDisposablesAreLeakedInTestSuite();
	const supported: IWindowMaterialCapabilities = {
		platform: 'darwin', windowsBuild: 0, memoryBytes: 16 * 1024 ** 3,
		logicalProcessors: 8, gpuCompositing: 'enabled', reduceTransparency: false, highContrast: false
	};

	test('automatic mode enforces performance requirements and supported platforms', () => {
		assert.strictEqual(getWindowMaterial(supported), 'sidebar');
		assert.strictEqual(getWindowMaterial({ ...supported, platform: 'win32', windowsBuild: 22621 }), 'acrylic');
		for (const override of [
			{ memoryBytes: 4 * 1024 ** 3 }, { logicalProcessors: 2 }, { gpuCompositing: 'disabled_software' },
			{ platform: 'linux' }, { platform: 'win32', windowsBuild: 22000 }
		]) {
			assert.strictEqual(getWindowMaterial({ ...supported, ...override }), undefined);
		}
	});

	test('enabled mode bypasses performance limits while preserving accessibility and platform constraints', () => {
		const slow = { ...supported, memoryBytes: 2 * 1024 ** 3, logicalProcessors: 2, gpuCompositing: 'disabled_software' };
		assert.strictEqual(getWindowMaterial(slow, true), 'sidebar');
		for (const override of [{ reduceTransparency: true }, { highContrast: true }, { platform: 'linux' }, { platform: 'win32', windowsBuild: 22000 }]) {
			assert.strictEqual(getWindowMaterial({ ...slow, ...override }, true), undefined);
		}
	});
});
