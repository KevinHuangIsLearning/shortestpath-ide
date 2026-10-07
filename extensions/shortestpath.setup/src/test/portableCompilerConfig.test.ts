/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import * as ts from 'typescript';
import { test } from 'node:test';
import { portableToolchain } from '../portableToolchainInstaller';

const compiler = 'C:\\Users\\Tester\\Downloads\\ShortestPath-IDE-Windows-x64\\data\\user-data\\User\\globalStorage\\shortestpath.shortestpath-setup\\toolchains\\winlibs\\mingw64-ucrt-15\\bin\\g++.exe';
const alias = 'C:\\.shortestpath-toolchain-0123456789ab\\User\\globalStorage\\shortestpath.shortestpath-setup\\toolchains\\winlibs\\mingw64-ucrt-15\\bin\\g++.exe';
const clangd = 'C:\\Tools\\clangd.exe';

function createHost(settings: Map<string, string | string[] | boolean>, workspaceSettings = new Map<string, string | string[] | boolean>(), folderSettings?: Map<string, string | string[] | boolean>, defaults = new Map<string, string>()) {
	const refreshed: string[] = [];
	const updates: string[] = [];
	const source = fs.readFileSync(path.join(__dirname, '../../src/extension.ts'), 'utf8') + '\nexport const testApi = { rebasePortableToolchain, configure };';
	const exports: { testApi?: { rebasePortableToolchain(context: object): Promise<void>; configure(context: object, selection: object): Promise<boolean> } } = {};
	vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
		exports, process: { platform: 'win32', env: {} }, console,
		require(id: string) {
			if (id === 'vscode') {
				return {
					env: { isAppPortable: true }, ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
					workspace: { workspaceFolders: folderSettings ? [{ uri: { scheme: 'file', fsPath: 'C:\\Code' } }] : [], getConfiguration: (_section: string, uri: object | null) => ({
						get: (key: string) => (uri ? folderSettings?.get(key) : undefined) ?? workspaceSettings.get(key) ?? settings.get(key) ?? defaults.get(key),
						inspect: (key: string) => ({ globalValue: settings.get(key), workspaceValue: workspaceSettings.get(key), workspaceFolderValue: uri ? folderSettings?.get(key) : undefined, defaultValue: defaults.get(key) }),
						update: async (key: string, value: string | string[] | boolean, target: number) => { updates.push(key); (target === 3 ? folderSettings! : target === 2 ? workspaceSettings : settings).set(key, value); }
					}) }
				};
			}
			if (id === 'fs') {
				return { existsSync: (filename: string) => filename === compiler || filename === alias || filename === clangd, readFileSync: () => JSON.stringify({ compilerCandidates: [compiler], clangdCandidates: [clangd], portableToolchain: true }) };
			}
			if (id === 'path') { return path.win32; }
			if (id === 'child_process') { return { execFile: (_file: string, _args: string[], _options: object, callback: (error: null, stdout: string, stderr: string) => void) => callback(null, 'g++ 15.2.0', '') }; }
			if (id === './compilerRuntime') { return require('../compilerRuntime'); }
			if (id === './portableToolchainInstaller') { return { portableToolchain: { ...portableToolchain, getSafeCompilerPath: () => alias, getRoot: () => 'C:\\IDE\\toolchains' } }; }
			if (id === './portableToolchain') { return require('../portableToolchain'); }
			if (id === './toolchainSelfTest') { return { compilerFallbackFlags: async (executable: string, _run: object, standard: string) => { refreshed.push(executable); return [`-std=${standard}`, '-isystem', 'C:/short/include']; } }; }
			if (id === './simpleSettings') { return { findCppStandard: (flags: string) => flags.includes('c++23') ? 'c++23' : 'c++20' }; }
			if (id.startsWith('./')) { return {}; }
			return require(id);
		}
	});
	const context = { extensionPath: 'extension', globalStorageUri: { fsPath: 'C:\\IDE\\storage' }, environmentVariableCollection: { prepend() {} }, globalState: { async update() {} } };
	return { run: () => exports.testApi!.rebasePortableToolchain(context), repair: () => exports.testApi!.configure(context, { mode: 'repair', installToolchain: false, cppStandard: 'c++20', completeSetup: false }), refreshed, updates };
}

for (const configuredCompiler of [compiler, alias]) {
	test(`migrates managed compiler options and header paths once: ${configuredCompiler === compiler ? 'original path' : 'existing junction'}`, async () => {
		const settings = new Map<string, string | string[] | boolean>([
			['judger.language.cpp.Command', configuredCompiler], ['judger.language.cpp.Args', '-std=c++23 -O0 -DLOCAL'],
			['c-cpp-compile-run.cpp-compiler', configuredCompiler], ['c-cpp-compile-run.cpp-flags', '-std=c++23 -O0 -DLOCAL'],
			['clangd.arguments', [`--query-driver=${configuredCompiler}`]], ['clangd.fallbackFlags', ['-isystem', 'C:/old/include']],
			['terminal.integrated.windowsUseConptyDll', true]
		]);
		const host = createHost(settings);
		await host.run();
		const updates = host.updates.length;
		await host.run();
		assert.deepEqual({
			compiler: settings.get('judger.language.cpp.Command'), flags: settings.get('judger.language.cpp.Args'),
			compileRun: settings.get('c-cpp-compile-run.cpp-compiler'), compileRunFlags: settings.get('c-cpp-compile-run.cpp-flags'),
			query: settings.get('clangd.arguments'), fallback: settings.get('clangd.fallbackFlags'),
			refreshed: host.refreshed, repeatedUpdates: host.updates.length - updates
		}, {
			compiler: alias, flags: '-std=c++23 -O0 -DLOCAL -no-canonical-prefixes',
			compileRun: alias, compileRunFlags: '-std=c++23 -O0 -DLOCAL -no-canonical-prefixes',
			query: [`--query-driver=${alias}`], fallback: ['-std=c++23', '-isystem', 'C:/short/include'],
			refreshed: [alias], repeatedUpdates: 0
		});
	});
}

test('portable configuration migration preserves separately configured system compilers', async () => {
	const settings = new Map<string, string | string[] | boolean>([
		['judger.language.cpp.Command', 'C:\\Custom\\g++.exe'], ['judger.language.cpp.Args', '-std=c++17 -O3'],
		['c-cpp-compile-run.cpp-compiler', 'C:\\Custom\\clang++.exe'], ['c-cpp-compile-run.cpp-flags', '-std=c++20 -O0'],
		['terminal.integrated.windowsUseConptyDll', true]
	]);
	const previous = [...settings];
	const host = createHost(settings);
	await host.run();
	assert.deepEqual({ settings: [...settings], refreshed: host.refreshed, updates: host.updates }, { settings: previous, refreshed: [], updates: [] });
});

test('migrates global, workspace and folder compiler options without mixing their values', async () => {
	const settings = new Map<string, string | string[] | boolean>([
		['judger.language.cpp.Command', compiler], ['judger.language.cpp.Args', '-std=c++23 -O3 -DGLOBAL'],
		['c-cpp-compile-run.cpp-compiler', compiler], ['c-cpp-compile-run.cpp-flags', '-std=c++23 -O3 -DGLOBAL'],
		['clangd.fallbackFlags', ['-isystem', 'C:/old/include']], ['terminal.integrated.windowsUseConptyDll', true]
	]);
	const workspaceSettings = new Map<string, string | string[] | boolean>([['judger.language.cpp.Args', '-std=c++20 -O0 -DWORKSPACE']]);
	const folderSettings = new Map<string, string | string[] | boolean>([['c-cpp-compile-run.cpp-flags', '-std=c++17 -O1 -DFOLDER']]);
	const host = createHost(settings, workspaceSettings, folderSettings);
	await host.run();
	const updates = host.updates.length;
	await host.run();
	assert.deepEqual({
		global: [settings.get('judger.language.cpp.Args'), settings.get('c-cpp-compile-run.cpp-flags')],
		workspace: [...workspaceSettings], folder: [...folderSettings], repeatedUpdates: host.updates.length - updates
	}, {
		global: ['-std=c++23 -O3 -DGLOBAL -no-canonical-prefixes', '-std=c++23 -O3 -DGLOBAL -no-canonical-prefixes'],
		workspace: [['judger.language.cpp.Args', '-std=c++20 -O0 -DWORKSPACE -no-canonical-prefixes'], ['clangd.fallbackFlags', ['-std=c++20', '-isystem', 'C:/short/include']]],
		folder: [['c-cpp-compile-run.cpp-flags', '-std=c++17 -O1 -DFOLDER -no-canonical-prefixes'], ['clangd.fallbackFlags', ['-std=c++20', '-isystem', 'C:/short/include']]], repeatedUpdates: 0
	});
});

for (const scope of ['workspace', 'folder']) {
	test(`managed ${scope} compiler migration preserves external global clangd configuration`, async () => {
		const settings = new Map<string, string | string[] | boolean>([
			['judger.language.cpp.Command', 'C:\\Custom\\g++.exe'], ['judger.language.cpp.Args', '-std=c++23 -O3 -DCUSTOM'],
			['c-cpp-compile-run.cpp-compiler', 'C:\\Custom\\g++.exe'],
			['clangd.arguments', ['--query-driver=C:/Custom/g++.exe']],
			['clangd.fallbackFlags', ['-std=c++23', '-isystem', 'C:/Custom/include', '-DCUSTOM']],
			['terminal.integrated.windowsUseConptyDll', true]
		]);
		const scoped = new Map<string, string | string[] | boolean>([
			['judger.language.cpp.Command', compiler], ['judger.language.cpp.Args', '-std=c++20 -O0'],
			['clangd.arguments', [`--query-driver=${compiler},C:/Custom/g++.exe`, '--background-index']]
		]);
		const previous = [...settings];
		const host = createHost(settings, scope === 'workspace' ? scoped : undefined, scope === 'folder' ? scoped : undefined);
		await host.run();
		const updates = host.updates.length;
		await host.run();
		assert.deepEqual({ global: [...settings], scoped: [...scoped], repeatedUpdates: host.updates.length - updates }, {
			global: previous,
			scoped: [
				['judger.language.cpp.Command', alias], ['judger.language.cpp.Args', '-std=c++20 -O0 -no-canonical-prefixes'],
				['clangd.arguments', [`--query-driver=${alias},C:/Custom/g++.exe`, '--background-index']],
				['clangd.fallbackFlags', ['-std=c++20', '-isystem', 'C:/short/include']]
			], repeatedUpdates: 0
		});
	});
}

test('repair preserves each default compiler option when no explicit flags are stored', async () => {
	const settings = new Map<string, string | string[] | boolean>([['terminal.integrated.windowsUseConptyDll', true]]);
	const defaults = new Map([['judger.language.cpp.Args', '-std=c++14 -O2'], ['c-cpp-compile-run.cpp-flags', '-Wall -Wextra -O2']]);
	const host = createHost(settings, undefined, undefined, defaults);
	assert.equal(await host.repair(), true);
	assert.deepEqual([settings.get('judger.language.cpp.Command'), settings.get('judger.language.cpp.Args'), settings.get('c-cpp-compile-run.cpp-flags')], [alias, '-std=c++14 -O2 -no-canonical-prefixes', '-Wall -Wextra -O2 -no-canonical-prefixes']);
});

test('main-process repair also retains default flags required by existing portable packages', async () => {
	const file = path.resolve(__dirname, '../../../../src/vs/code/electron-main/app.ts');
	const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
	const application = source.statements.find(statement => ts.isClassDeclaration(statement) && statement.name?.text === 'CodeApplication');
	assert.ok(application && ts.isClassDeclaration(application));
	const method = application.members.find(member => ts.isMethodDeclaration(member) && member.name.getText(source) === 'applyShortestPathWindowsSetup');
	assert.ok(method);
	const exports: { application?: { applyShortestPathWindowsSetup(request: object): Promise<void> } } = {};
	const settings = new Map<string, string>();
	const defaults = new Map([['cph.language.cpp.Args', '-std=c++14 -O2'], ['c-cpp-compile-run.cpp-flags', '-Wall -Wextra -O2']]);
	vm.runInNewContext(ts.transpileModule(`class SetupTest { ${method.getText(source)} } exports.application = Object.assign(new SetupTest(), dependencies);`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, {
		exports, join: path.win32.join, ConfigurationTarget: { USER: 1 }, dependencies: {
			getShortestPathToolchainRoot: () => 'C:\\IDE\\toolchains',
			getShortestPathPortableSupport: () => ({ getSafeCompilerPath: () => alias, withCompilerPathFlags: portableToolchain.withCompilerPathFlags }),
			environmentMainService: { isPortable: true },
			configurationService: { getValue: () => ({}), inspect: (key: string) => ({ defaultValue: defaults.get(key) }), updateValue: async (key: string, value: string) => { settings.set(key, value); } },
			async createShortestPathClangdConfig() {}
		}
	});
	await exports.application!.applyShortestPathWindowsSetup({ mode: 'repair', cppStandard: 'c++20', workspaceFolder: 'C:\\Code' });
	assert.deepEqual([settings.get('cph.language.cpp.Command'), settings.get('cph.language.cpp.Args'), settings.get('c-cpp-compile-run.cpp-flags')], [alias, '-std=c++14 -O2 -no-canonical-prefixes', '-Wall -Wextra -O2 -no-canonical-prefixes']);
});
