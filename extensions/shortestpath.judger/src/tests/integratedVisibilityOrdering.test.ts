/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import vm from 'vm';

test('dirty-state and save refreshes never open or focus a sidebar, even with a stale visible Judge view', async () => {
	const compiled = fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');
	const start = compiled.indexOf('function updateJudgeVisibility(');
	const end = compiled.indexOf('const getJudgeViewProvider', start);
	const commands: string[] = [];
	const context = vm.createContext({
		exports: {},
		judgeViewProvider: { isViewVisible: () => true },
		statusBarItem: { hide() { }, show() { } },
		integratedTests_1: { usesIntegratedTests: (value: boolean) => value },
		vscode: { commands: { executeCommand: (command: string) => { commands.push(command); return Promise.resolve(); } } },
	});
	vm.runInContext(`${compiled.slice(start, end)}; globalThis.update = updateJudgeVisibility;`, context);
	// The tab API emits updates both when typing makes a tab dirty and saving clears it.
	for (const integrated of [true, true, true, false, true, true]) {
		context.update(integrated);
	}
	await Promise.resolve();
	expect(commands).toEqual(Array(6).fill('setContext'));
});
