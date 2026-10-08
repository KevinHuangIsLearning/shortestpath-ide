/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { minifyDependency } from '../minifyDependency.ts';

test('dependency whitespace minimization preserves exports, names, serialized functions and license', () => {
	const input = Buffer.from(`/*! Copyright fixture; MIT license */
function serializedFunction(value) {
    const namedLocal = value + 1;
    return { result: namedLocal, text: "a  b\\n" };
}
module.exports = { serializedFunction, run: value => serializedFunction(value) };
`);
	const output = minifyDependency('node_modules/playwright-core/lib/fixture.js', input);
	assert.ok(output.length < input.length);
	assert.match(output.toString(), /Copyright fixture; MIT license/);
	const context = { module: { exports: {} as { serializedFunction: (value: number) => unknown; run: (value: number) => unknown } } };
	vm.runInNewContext(output.toString(), context);
	assert.equal(context.module.exports.serializedFunction.name, 'serializedFunction');
	assert.equal(JSON.stringify(context.module.exports.run(3)), JSON.stringify({ result: 4, text: 'a  b\n' }));
	const serialized = vm.runInNewContext(`(${context.module.exports.serializedFunction.toString()})(3)`);
	assert.equal(JSON.stringify(serialized), JSON.stringify({ result: 4, text: 'a  b\n' }));
});

test('unselected sources, non-JavaScript resources, and non-dependency paths remain byte-identical', () => {
	const input = Buffer.from('Flow source that is intentionally not valid JavaScript');
	for (const file of ['node_modules/katex/src/Parser.js', 'node_modules/zod/package.json', 'out/vs/workbench.js', 'node_modules/zod/LICENSE']) {
		assert.strictEqual(minifyDependency(file, input), input);
	}
});

test('selected malformed JavaScript fails the build instead of emitting a partial runtime', () => {
	assert.throws(() => minifyDependency('node_modules/zod/index.js', Buffer.from('export const =')));
});
