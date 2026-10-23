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

function createHost(folders: readonly { name: string; uri: { scheme: string; fsPath: string } }[], platform = process.platform) {
	const notifications: string[] = [];
	const failures: string[] = [];
	const source = fs.readFileSync(path.join(__dirname, '../../src/extension.ts'), 'utf8') + '\nexport const testApi = { ensureOiWorkspaceInitialization, createDefaultClangdProjectConfig };';
	const settingsSource = ts.createSourceFile('simpleSettings.ts', fs.readFileSync(path.join(__dirname, '../../src/simpleSettings.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
	const standardFunction = settingsSource.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'findCppStandard')!;
	const settingsExports: { findCppStandard?: (flags: string) => string } = {};
	vm.runInNewContext(ts.transpileModule(standardFunction.getText(settingsSource), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: settingsExports });
	const exports: { testApi?: {
		ensureOiWorkspaceInitialization(context: object): Promise<void>;
		createDefaultClangdProjectConfig(folder: string, compiler: string, standard: string, updateGenerated: boolean): void;
	}; } = {};
	vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
		exports, process: { ...process, platform }, console: { error: (message: string) => failures.push(message) },
		require(id: string) {
			if (id === 'vscode') {
				return {
					Uri: { file: (fsPath: string) => ({ fsPath }) },
					workspace: { workspaceFolders: folders, getConfiguration: (section: string) => ({ get: (key: string) => section === 'editor' && key === 'tabSize' ? 4 : key === 'Args' ? '-std=c++17 -O2' : '/tools/g++' }) },
					window: { showInformationMessage: (message: string) => notifications.push(message) }
				};
			}
			if (id === './cppFormatting') { return { defaultClangFormatConfig: (width: number) => `IndentWidth: ${width}\n` }; }
			if (id === './portableToolchain') { return { managedClangdConfigMarker: require('../portableToolchain').managedClangdConfigMarker }; }
			if (id === './simpleSettings') { return settingsExports; }
			if (id.startsWith('./')) { return {}; }
			return require(id);
		}
	});
	// Previously dismissed prompts must not suppress automatic initialization.
	const context = { workspaceState: { get() { assert.fail('automatic initialization must not read the old dismissal'); } } };
	return {
		run: () => exports.testApi!.ensureOiWorkspaceInitialization(context),
		configure: (folder: string) => exports.testApi!.createDefaultClangdProjectConfig(folder, '/selected/g++', 'c++23', true),
		notifications, failures
	};
}

function temporaryFolder(t: { after(callback: () => void): void }) {
	const fsPath = fs.mkdtempSync(path.join(os.tmpdir(), 'shortestpath-oi-config-'));
	t.after(() => fs.rmSync(fsPath, { recursive: true, force: true }));
	return { name: path.basename(fsPath), uri: { scheme: 'file', fsPath } };
}

test('automatically creates both missing configs without notifications and is idempotent', async t => {
	const folder = temporaryFolder(t);
	const host = createHost([folder]);
	await host.run();
	const clangd = fs.readFileSync(path.join(folder.uri.fsPath, '.clangd'), 'utf8');
	assert.match(clangd, /Compiler: "\/tools\/g\+\+"/);
	assert.match(clangd, /-std=c\+\+17/);
	assert.doesNotMatch(clangd, /__float128/);
	fs.writeFileSync(path.join(folder.uri.fsPath, '.clangd'), 'custom clangd');
	await host.run();
	assert.deepEqual({
		clangd: fs.readFileSync(path.join(folder.uri.fsPath, '.clangd'), 'utf8'),
		format: fs.readFileSync(path.join(folder.uri.fsPath, '.clang-format'), 'utf8'),
		notifications: host.notifications, failures: host.failures
	}, { clangd: 'custom clangd', format: 'IndentWidth: 4\n', notifications: [], failures: [] });
});

test('first-run selection refreshes the generated compiler and standard but preserves custom content', async t => {
	const folder = temporaryFolder(t);
	const host = createHost([folder]);
	await host.run();
	host.configure(folder.uri.fsPath);
	const configPath = path.join(folder.uri.fsPath, '.clangd');
	const generated = fs.readFileSync(configPath, 'utf8');
	assert.match(generated, /-std=c\+\+23/);
	assert.match(generated, /Compiler: "\/selected\/g\+\+"/);
	const custom = generated.replace('-std=c++23', '-std=c++11') + '\n# custom project setting\n';
	fs.writeFileSync(configPath, custom);
	host.configure(folder.uri.fsPath);
	assert.equal(fs.readFileSync(configPath, 'utf8'), custom);
});

for (const platform of ['linux', 'darwin', 'win32'] as const) {
	test(`migrates generated configs with the platform-appropriate float128 flags on ${platform}`, async t => {
		const folder = temporaryFolder(t);
		const configPath = path.join(folder.uri.fsPath, '.clangd');
		fs.writeFileSync(configPath, `# Managed by ShortestPath IDE setup.
CompileFlags:
  Add:
    - -std=c++23
    - -Wall
    - -Wextra
    - -DDEBUG
    - "-Drsize_t=size_t"
    - "-D__STDC_WANT_LIB_EXT1__=1"
    - "-D__float128=long double"
    - -U__SIZEOF_FLOAT128__${platform === 'darwin' ? '\n    - -I/opt/homebrew/include' : ''}
  BuiltinHeaders: QueryDriver
  Compiler: "/selected/g++"

Completion:
  HeaderInsertion: Never

Index:
  Background: Build
`);
		const host = createHost([folder], platform);
		host.configure(folder.uri.fsPath);
		const migrated = fs.readFileSync(configPath, 'utf8');
		if (platform === 'win32') { assert.match(migrated, /-D__float128=long double/); }
		else { assert.doesNotMatch(migrated, /__float128/); }
		assert.match(migrated, /-std=c\+\+23/);
		assert.match(migrated, /Compiler: "\/selected\/g\+\+"/);
	});
}

for (const existing of ['.clangd', '.clang-format']) {
	test(`preserves existing ${existing} while filling the missing config`, async t => {
		const folder = temporaryFolder(t);
		fs.writeFileSync(path.join(folder.uri.fsPath, existing), 'user configuration');
		const host = createHost([folder]);
		await host.run();
		assert.deepEqual({
			files: fs.readdirSync(folder.uri.fsPath).sort(),
			existing: fs.readFileSync(path.join(folder.uri.fsPath, existing), 'utf8'),
			notifications: host.notifications, failures: host.failures
		}, { files: ['.clang-format', '.clangd'], existing: 'user configuration', notifications: [], failures: [] });
	});
}

test('skips unsupported workspaces and handles write failures without rejecting activation', async t => {
	const folder = temporaryFolder(t);
	for (const folders of [[], [folder, folder], [{ ...folder, uri: { ...folder.uri, scheme: 'vscode-remote' } }]]) {
		const host = createHost(folders);
		await host.run();
		assert.deepEqual([fs.readdirSync(folder.uri.fsPath), host.notifications, host.failures], [[], [], []]);
	}
	const file = path.join(folder.uri.fsPath, 'file');
	fs.writeFileSync(file, '');
	const host = createHost([{ ...folder, uri: { scheme: 'file', fsPath: file } }]);
	await host.run();
	assert.deepEqual([host.notifications, host.failures], [[], ['Failed to initialize OI workspace configuration']]);
});
