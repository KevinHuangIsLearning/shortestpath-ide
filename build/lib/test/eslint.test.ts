/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ESLint } from 'eslint';
import { suite, test } from 'node:test';
import { getEslintFilePatterns, shouldErrorOnUnmatchedPattern } from '../../eslint.ts';
import { eslintFilter } from '../../filters.ts';

suite('eslint', () => {

	test('enforces source attribution for authored and upstream files', async () => {
		const linter = new ESLint();
		const header = (owner: string, license: string) => `/*---------------------------------------------------------------------------------------------
 *  Copyright (c) ${owner}
 *  Licensed under the ${license}
 *--------------------------------------------------------------------------------------------*/
`;
		const authored = header('2026 ShortestPath IDE contributors.', 'GPL-3.0-or-later license. See LICENSE in the project root for license information.');
		const upstream = header('Microsoft Corporation. All rights reserved.', 'MIT License. See License.txt in the project root for license information.');
		const cases = [
			['extensions/shortestpath.judger/src/problemDisplay.ts', authored, upstream],
			['extensions/shortestpath.setup/resources/windows.js', authored, upstream],
			['src/vs/base/node/portablePaths.ts', authored, upstream],
			['src/vs/base/common/arrays.ts', upstream, authored],
		];
		const results = [];
		for (const [filePath, accepted, rejected] of cases) {
			const valid = (await linter.lintText(accepted, { filePath }))[0];
			const invalid = (await linter.lintText(rejected, { filePath }))[0];
			results.push([valid.messages.filter(message => message.ruleId === 'header/header').length, invalid.messages.filter(message => message.ruleId === 'header/header').length]);
		}
		assert.deepStrictEqual(results, [[0, 1], [0, 1], [0, 1], [0, 1]]);
	});

	test('uses the full filter when no positional arguments are provided', () => {
		assert.deepStrictEqual(getEslintFilePatterns([]), Array.from(eslintFilter));
	});

	test('uses positional arguments without the full filter', () => {
		const files = ['src/vs/base/common/arrays.ts', 'src/vs/base/common/async.ts'];

		assert.deepStrictEqual(getEslintFilePatterns(files), files);
	});

	test('errors on unmatched positional arguments only', () => {
		assert.deepStrictEqual([
			shouldErrorOnUnmatchedPattern([]),
			shouldErrorOnUnmatchedPattern(['src/vs/base/common/arrays.ts']),
		], [false, true]);
	});
});
