/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { suite, test } from 'node:test';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { SourceMapConsumer } from 'source-map';
import { mapWithConcurrency, transpileLocalizedFiles } from '../transpile.ts';

suite('transpile', () => {
	test('bounds concurrent work and preserves result order', async () => {
		let active = 0;
		let maximumActive = 0;

		const results = await mapWithConcurrency([0, 1, 2, 3, 4], 2, async item => {
			active++;
			maximumActive = Math.max(maximumActive, active);
			await new Promise(resolve => setImmediate(resolve));
			active--;
			return item * 2;
		});

		assert.deepStrictEqual({ maximumActive, results }, {
			maximumActive: 2,
			results: [0, 2, 4, 6, 8],
		});
	});

	test('propagates errors and stops scheduling work', async () => {
		const started: number[] = [];

		await assert.rejects(mapWithConcurrency([0, 1, 2, 3], 2, async item => {
			started.push(item);
			if (item === 0) {
				throw new Error('expected failure');
			}
			await new Promise(resolve => setImmediate(resolve));
		}), /expected failure/);

		assert.deepStrictEqual(started, [0, 1]);
	});
});


test('localized transpilation matches numeric calls to metadata, preserves fallback and source maps', async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'localized-transpile-'));
	try {
		const src = path.join(root, 'src');
		const out = path.join(root, 'out');
		await fs.mkdir(src);
		const source = `import { localize, localize2 } from './vs/nls.js';
const first = localize('z', 'Fallback {0}', 7);
const second = localize2('a', 'Original');
console.log(first, second);
`;
		await fs.writeFile(path.join(src, 'example.ts'), source);
		await transpileLocalizedFiles(src, out, ['example.ts']);
		const keys = JSON.parse(await fs.readFile(path.join(out, 'nls.keys.json'), 'utf8'));
		const messages = JSON.parse(await fs.readFile(path.join(out, 'nls.messages.json'), 'utf8'));
		assert.deepStrictEqual(keys, [['example', ['a', 'z']]]);
		assert.deepStrictEqual(messages, ['Original', 'Fallback {0}']);
		const code = await fs.readFile(path.join(out, 'example.js'), 'utf8');
		assert.doesNotMatch(code, /%%NLS/);
		assert.match(code, /localize\(1, "Fallback \{0\}", 7\)/);
		assert.match(code, /localize2\(0, "Original"\)/);
		let values: unknown[] = [];
		const translated = ['原文', '回退 {0}'];
		const localize = (index: number, fallback: string, value?: number) => (translated[index] ?? fallback).replace('{0}', String(value));
		vm.runInNewContext(code.replace(/^import .*$/m, ''), {
			localize, localize2: (index: number, original: string) => ({ value: localize(index, original), original }),
			console: { log: (...args: unknown[]) => values = args }
		});
		assert.equal(values[0], '回退 7');
		assert.equal((values[1] as { value: string }).value, '原文');
		const map = new SourceMapConsumer(JSON.parse(await fs.readFile(path.join(out, 'example.js.map'), 'utf8')));
		const lines = code.split('\n');
		const line = lines.findIndex(line => line.includes('console.log'));
		assert.equal(map.originalPositionFor({ line: line + 1, column: lines[line].indexOf('console') }).line, 4);
	} finally {
		await fs.rm(root, { recursive: true, force: true });
	}
});
