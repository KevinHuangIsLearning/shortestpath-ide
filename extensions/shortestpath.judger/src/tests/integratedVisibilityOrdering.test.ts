/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import vm from 'vm';

test('repeated SP updates keep the pending CPH exit, while switching to another judge cancels it', async () => {
	const compiled = fs.readFileSync(path.resolve(__dirname, '../extension.js'), 'utf8');
	const start = compiled.indexOf('function updateJudgeVisibility(');
	const end = compiled.indexOf('const getJudgeViewProvider', start);
	const finish: Array<() => void> = [];
	const commands: string[] = [];
	let visible = true;
	const context = vm.createContext({
		exports: {},
		judgeVisibilityVersion: 0, judgeIntegrated: false,
		judgeViewProvider: { isViewVisible: () => visible },
		statusBarItem: { hide() { }, show() { } },
		integratedTests_1: { usesIntegratedTests: (value: boolean) => value },
		vscode: { commands: { executeCommand: (command: string) => { commands.push(command); return command === 'setContext' ? new Promise<void>(resolve => { finish.push(resolve); }) : Promise.resolve(); } } },
	});
	vm.runInContext(`${compiled.slice(start, end)}; globalThis.update = updateJudgeVisibility;`, context);
	context.update(true); visible = false; context.update(true);
	finish.splice(0).forEach(resolve => resolve());
	await Promise.resolve();
	expect(commands.filter(command => command === 'workbench.view.explorer')).toHaveLength(1);
	commands.length = 0;
	visible = true; context.update(true); context.update(false);
	finish.splice(0).forEach(resolve => resolve());
	await Promise.resolve();
	expect(commands.filter(command => command === 'workbench.view.explorer')).toHaveLength(0);
});
