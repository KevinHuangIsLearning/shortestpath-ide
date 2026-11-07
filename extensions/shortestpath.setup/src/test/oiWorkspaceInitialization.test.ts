/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vm from 'node:vm';
import * as ts from 'typescript';
import { test } from 'node:test';

function createHost(folder?: string) {
	const settings = new Map<string, string | string[]>([
		['judger.language.cpp.Command', '/tools/g++'], ['judger.language.cpp.Args', '-std=c++17 -O2']
	]);
	const state = new Map<string, string>();
	const workspaceSettings = new Map<string, string | string[]>();
	const probes: string[] = [];
	const updates: string[] = [];
	const source = fs.readFileSync(path.join(__dirname, '../../src/extension.ts'), 'utf8') + '\nexport const testApi = { ensureGlobalClangdConfiguration };';
	const exports: { testApi?: { ensureGlobalClangdConfiguration(context: object): Promise<void> } } = {};
	vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
		exports, process, console,
		require(id: string) {
			if (id === 'vscode') {
				return {
					ConfigurationTarget: { Global: 1 },
					extensions: { getExtension: () => undefined },
					workspace: {
						workspaceFolders: folder ? [{ uri: { scheme: 'file', fsPath: folder } }] : undefined,
						getConfiguration: () => ({
							get: (key: string) => workspaceSettings.get(key) ?? settings.get(key),
							inspect: (key: string) => ({ globalValue: settings.get(key), workspaceValue: workspaceSettings.get(key) }),
							update: async (key: string, value: string | string[], target: number) => {
								assert.equal(target, 1);
								updates.push(key); settings.set(key, value);
							}
						})
					}
				};
			}
			if (id === './toolchainSelfTest') {
				return { compilerFallbackFlags: async (compiler: string, _run: object, standard: string) => {
					probes.push(compiler); return [`-std=${standard}`, '-isystem', `${compiler}/include`];
				} };
			}
			if (id === './simpleSettings') { return { findCppStandard: (flags: string) => /-std=(c\+\+\d+)/.exec(flags)?.[1] ?? 'c++20' }; }
			if (id.startsWith('./')) { return {}; }
			return require(id);
		}
	});
	return {
		settings, workspaceSettings, probes, updates,
		run: () => exports.testApi!.ensureGlobalClangdConfiguration({ globalState: { get: (key: string) => state.get(key), update: async (key: string, value: string) => { state.set(key, value); } } })
	};
}

test('sets global defaults for standalone files and avoids repeated compiler probes', async () => {
	const host = createHost();
	await host.run();
	const updates = host.updates.length;
	await host.run();
	assert.deepEqual(Array.from(host.settings.get('clangd.fallbackFlags')!), ['-std=c++17', '-isystem', '/tools/g++/include']);
	const args = host.settings.get('clangd.arguments') as string[];
	assert.ok(args.includes('--header-insertion=never'));
	assert.ok(args.includes('--background-index'));
	assert.ok(args.some(argument => argument.startsWith('--query-driver=')));
	assert.ok(!args.some(argument => /--compile-commands-dir|--enable-config=false/.test(argument)));
	assert.deepEqual(host.probes, ['/tools/g++']);
	assert.equal(host.updates.length, updates);
});

test('refreshes defaults when compiler or standard changes and keeps custom startup options', async () => {
	const host = createHost();
	host.settings.set('clangd.arguments', ['--log=verbose', '--header-insertion=iwyu']);
	await host.run();
	host.settings.set('judger.language.cpp.Command', '/new/g++');
	host.settings.set('judger.language.cpp.Args', '-std=c++23');
	await host.run();
	assert.deepEqual(Array.from(host.settings.get('clangd.fallbackFlags')!), ['-std=c++23', '-isystem', '/new/g++/include']);
	const args = host.settings.get('clangd.arguments') as string[];
	assert.ok(args.includes('--log=verbose'));
	assert.ok(args.includes('--header-insertion=iwyu'));
	assert.ok(!args.includes('--header-insertion=never'));
	if (process.platform !== 'darwin') { assert.ok(args.includes('--query-driver=/new/g++')); }
});

test('does not promote workspace compiler settings into global defaults', async () => {
	const host = createHost();
	host.workspaceSettings.set('judger.language.cpp.Command', '/project/g++');
	host.workspaceSettings.set('judger.language.cpp.Args', '-std=c++11');
	host.workspaceSettings.set('clangd.arguments', ['--compile-commands-dir=/project/build']);
	await host.run();
	assert.deepEqual(host.probes, ['/tools/g++']);
	assert.deepEqual(Array.from(host.settings.get('clangd.fallbackFlags')!), ['-std=c++17', '-isystem', '/tools/g++/include']);
	assert.ok(!(host.settings.get('clangd.arguments') as string[]).some(argument => argument.startsWith('--compile-commands-dir')));
});

test('leaves clangd untouched when no compiler is configured', async () => {
	const host = createHost();
	host.settings.delete('judger.language.cpp.Command');
	await host.run();
	assert.deepEqual(host.probes, []);
	assert.deepEqual(host.updates, []);
});

for (const existing of [undefined, '.clangd', 'compile_commands.json', '.clang-format']) {
	test(`does not create or rewrite project files (${existing ?? 'empty folder'})`, async t => {
		const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'shortestpath-oi-config-'));
		t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
		if (existing) { fs.writeFileSync(path.join(folder, existing), 'user configuration'); }
		await createHost(folder).run();
		assert.deepEqual(fs.readdirSync(folder), existing ? [existing] : []);
		if (existing) { assert.equal(fs.readFileSync(path.join(folder, existing), 'utf8'), 'user configuration'); }
	});
}
