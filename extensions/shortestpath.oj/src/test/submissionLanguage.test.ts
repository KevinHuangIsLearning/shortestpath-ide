/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';
import type { SubmissionLanguage } from '../shortestpathOjProtocol';

const languages: SubmissionLanguage[] = [
	{ id: 'cpp14', name: 'C++14', compileArgs: '-std=c++14' },
	{ id: 'cpp20', name: 'C++20', compileArgs: '-std=c++20' },
];

function createPicker(configured: string, selection: number | undefined) {
	const choices: { label: string; language?: SubmissionLanguage; openSettings?: boolean }[][] = [];
	const commands: string[][] = [];
	const context = vm.createContext({
		vscode: {
			workspace: { getConfiguration: () => ({ get: () => configured }) },
			window: { showQuickPick: async (items: typeof choices[number]) => { choices.push(items); return selection === undefined ? undefined : items[selection]; } },
			commands: { executeCommand: async (...args: string[]) => { commands.push(args); } },
		},
		localization_1: { localize: (text: string) => text },
	});
	const source = fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');
	const start = source.indexOf('async function selectSubmissionLanguage(');
	const end = source.indexOf('function forwardSamplesToCph(', start);
	assert.ok(start >= 0 && end > start);
	vm.runInContext(source.slice(start, end), context);
	const select = context.selectSubmissionLanguage as (items: SubmissionLanguage[], sourcePath: string) => Promise<SubmissionLanguage | undefined>;
	return { choices, commands, select };
}

test('asking for C++ offers a settings link that ends the current submission', async () => {
	const picker = createPicker('ask', 2);
	assert.equal(await picker.select(languages, 'main.cpp'), undefined);
	assert.deepStrictEqual({ labels: picker.choices[0].map(item => item.label), commands: picker.commands }, {
		labels: ['C++14', 'C++20', '不想每次询问，去设置'],
		commands: [['workbench.action.openSettings', '@id:shortestpath.oj.cppSubmissionLanguage']],
	});
});

test('choosing a language or dismissing the picker never opens settings', async () => {
	for (const selection of [0, 1, undefined]) {
		const picker = createPicker('ask', selection);
		assert.equal(await picker.select(languages, 'main.cpp'), selection === undefined ? undefined : languages[selection]);
		assert.deepStrictEqual(picker.commands, []);
	}
});

test('fixed C++ preferences bypass the picker and unrelated language prompts have no C++ settings link', async () => {
	const fixed = createPicker('cpp20', undefined);
	assert.equal(await fixed.select(languages, 'main.cpp'), languages[1]);
	assert.deepStrictEqual(fixed.choices, []);
	const other = createPicker('ask', 0);
	assert.equal(await other.select(languages, 'main.py'), languages[0]);
	assert.deepStrictEqual(other.choices[0].map(item => item.label), ['C++14', 'C++20']);
});
