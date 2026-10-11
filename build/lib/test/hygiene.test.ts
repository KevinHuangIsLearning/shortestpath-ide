/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { spawnSync } from 'child_process';
import es from 'event-stream';
import { statSync } from 'fs';
import path from 'path';
import { suite, test } from 'node:test';
import VinylFile from 'vinyl';
import { hygiene } from '../../hygiene.ts';

suite('hygiene', () => {
	const repositoryRoot = path.join(import.meta.dirname, '../../..');

	test('formatting and copyright exemptions preserve subsequent checks', async () => {
		const cases = [
			{
				file: 'extensions/shortestpath.oj/src/generated/api-contract.ts',
				runEslint: false,
				// Generated indentation is exempt, but a missing copyright is still rejected.
				source: 'export type Example = {\n  value: string;\n};\n',
			},
			{
				file: 'extensions/shortestpath.judger/src/nativeRunner.ts',
				runEslint: true,
				// Its historical copyright notice is exempt from the generic checker only.
				source: `/*---------------------------------------------------------------------------------------------
 * Part of ShortestPath Judger.
 * Licensed under GPL-3.0-or-later. See LICENSE for license information.
 *--------------------------------------------------------------------------------------------*/

export var value = 1;
`,
			},
		];
		for (const { file, source, runEslint } of cases) {
			const fullPath = path.join(repositoryRoot, file);
			const input = new VinylFile({ path: fullPath, base: repositoryRoot, contents: Buffer.from(source), stat: statSync(fullPath) });
			await assert.rejects(new Promise<void>((resolve, reject) => {
				hygiene(es.readArray([input]), runEslint)
					.on('data', () => { })
					.on('end', resolve)
					.on('error', error => reject(new Error(String(error))));
			}), /Hygiene failed/);
		}
	});

	test('rejects requested files that enter no hygiene checker', () => {
		for (const file of [
			'src/vs/editor/contrib/colorPicker/browser/images/opacity-background.png',
			'src/vs/workbench/browser/media/fonts/FiraCode-VF.ttf',
			'src/vs/workbench/contrib/externalTerminal/node/TerminalHelper.scpt',
		]) {
			const result = spawnSync(process.execPath, [
				'--experimental-strip-types',
				'build/hygiene.ts',
				file,
			], {
				cwd: repositoryRoot,
				encoding: 'utf8',
			});

			assert.deepStrictEqual({
				status: result.status,
				hasNoMatchError: result.stderr.includes('No hygiene-eligible files matched the requested paths'),
			}, {
				status: 1,
				hasNoMatchError: true,
			});
		}
	});
});
