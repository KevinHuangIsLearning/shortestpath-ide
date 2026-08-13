/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { registerSimpleSettings } from './simpleSettings';
import { registerRelaxMode } from './relaxMode';
import { registerCphSettings } from './cphSettings';
import { registerGettingStarted } from './gettingStarted';
import { registerToolchainDiagnostics } from './toolchainDiagnostics';
import { getPortableDataRoot, managedClangdConfigMarker, rebaseGeneratedClangdConfig, rebaseManagedQueryDriver, rebaseManagedToolchainPath } from './portableToolchain';

type PlatformPreset = {
	portableToolchain: boolean;
	compilerCandidates: string[];
	clangdCandidates: string[];
	installDescription: string;
	downloadSources?: DownloadSource[];
};

type DownloadSource = { id: string; unavailable?: boolean };

type PlatformInstaller = {
	createCommand?(input: { toolchainRoot: string; source?: DownloadSource; stage?: string; locale?: string }): string;
	getPortableAssets?(input: { toolchainRoot: string; source?: DownloadSource; stage?: string; locale?: string }): readonly unknown[];
};

type SetupSelection = 'recommended';

type FirstRunSelection = {
	mode: SetupSelection;
	installToolchain: boolean;
	cppStandard: 'c++11' | 'c++14' | 'c++17' | 'c++20' | 'c++23';
	workspaceFolder: string;
};

const SETUP_COMPLETE = 'shortestpath.setupComplete';
const OI_WORKSPACE_INITIALIZATION_DISMISSED = 'shortestpath.oiWorkspaceInitializationDismissed';

const shortestPathHiddenFiles: Record<string, boolean> = {
	'**/.cph': true,
	'**/.clang-format': true,
	'**/.clangd': true,
	'**/*.exe': true,
	'**/*.bin': true,
	'**/*.bin.dSYM': true,
	'**/*.dSYM': true,
	'**/.*': true
};

const FILE_EXCLUDES_MIGRATION = 'shortestpath.fileExcludes.v3';
const OJ_MAPPING_MIGRATION = 'shortestpath.ojMapping.v2';
const FILE_NAME_TEMPLATE_OVERRIDES_MIGRATION = 'shortestpath.fileNameTemplateOverrides.v1';
const shortestPathOjMapping = {
	oj: 'ShortestPath',
	ojName: 'ShortestPath',
	contestIdRegex: 'problem\\/([^\\/]+)\\/[^\\/]+\\/[^\\/]+',
	problemIdRegex: 'problem\\/[^\\/]+\\/(.+)$'
};

function clangdArgumentsForCompiler(compiler: string): string[] {
	// Homebrew exposes GCC through multiple symlinked paths, for example both
	// /opt/homebrew/bin/g++-16 and /opt/homebrew/opt/gcc/bin/g++-16. clangd
	// matches --query-driver against the path in its CompileFlags config before
	// resolving that symlink, so allowing only the selected path can leave GCC's
	// libstdc++ headers (including bits/stdc++.h) undiscovered.
	if (process.platform === 'darwin') {
		return [
			'--background-index',
			'--query-driver=/opt/homebrew/**/g++-*,/usr/local/**/g++-*'
		];
	}
	return ['--background-index', `--query-driver=${compiler}`];
}

function defaultClangdProjectConfig(compiler: string, cppStandard: FirstRunSelection['cppStandard']): string {
	const includePath = process.platform === 'darwin' ? '\n    - -I/opt/homebrew/include' : '';
	const compilerPath = compiler.replaceAll('\\', '/');
	return `${managedClangdConfigMarker}
CompileFlags:
  Add:
    - -std=${cppStandard}
    - -Wall
    - -Wextra
    - "-Drsize_t=size_t"
    - "-D__STDC_WANT_LIB_EXT1__=1"
    - "-D__float128=long double"
    - -U__SIZEOF_FLOAT128__${includePath}
  BuiltinHeaders: QueryDriver
  Compiler: ${JSON.stringify(compilerPath)}

Completion:
  HeaderInsertion: Never

Index:
  Background: Build
`;
}

function createDefaultClangdConfig(configPath: string, compiler: string, cppStandard: FirstRunSelection['cppStandard']): void {
	if (fs.existsSync(configPath)) {
		return;
	}
	fs.mkdirSync(path.dirname(configPath), { recursive: true });
	try {
		fs.writeFileSync(configPath, defaultClangdProjectConfig(compiler, cppStandard), { encoding: 'utf8', flag: 'wx' });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
			throw error;
		}
	}
}

function createDefaultClangdProjectConfig(workspaceFolder: string, compiler: string, cppStandard: FirstRunSelection['cppStandard']): void {
	createDefaultClangdConfig(path.join(workspaceFolder, '.clangd'), compiler, cppStandard);
}

const defaultClangFormatConfig = `BasedOnStyle: Google

# --- 行为：尽量允许一行写完 ---
AllowShortIfStatementsOnASingleLine: AllIfsAndElse
AllowShortLoopsOnASingleLine: true
AllowShortBlocksOnASingleLine: true
AllowShortFunctionsOnASingleLine: Inline

# --- 行长（核心关键，不然上面全白给） ---
ColumnLimit: 0

# --- 缩进 ---
IndentWidth: 4
TabWidth: 4
UseTab: Never

# --- 访问修饰符 ---
AccessModifierOffset: -2

# --- 大括号风格 ---
BreakBeforeBraces: Attach
AlwaysBreakTemplateDeclarations: No

# --- 指针与注释 ---
PointerAlignment: Left
SpacesBeforeTrailingComments: 4

# --- 代码块间距 ---
SeparateDefinitionBlocks: Always

# --- 语言标准 ---
Standard: Latest
`;

function createDefaultClangFormatConfig(workspaceFolder: string): void {
	const configPath = path.join(workspaceFolder, '.clang-format');
	if (fs.existsSync(configPath)) {
		return;
	}
	try {
		fs.writeFileSync(configPath, defaultClangFormatConfig, { encoding: 'utf8', flag: 'wx' });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
			throw error;
		}
	}
}

function getSingleLocalWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (workspaceFolders?.length !== 1 || workspaceFolders[0].uri.scheme !== 'file') {
		return undefined;
	}
	return workspaceFolders[0];
}

function hasOiWorkspaceConfig(workspaceFolder: vscode.WorkspaceFolder): boolean {
	return fs.existsSync(path.join(workspaceFolder.uri.fsPath, '.clangd'))
		|| fs.existsSync(path.join(workspaceFolder.uri.fsPath, '.clang-format'));
}

async function initializeOiWorkspace(context: vscode.ExtensionContext): Promise<void> {
	const workspaceFolder = getSingleLocalWorkspaceFolder();
	if (!workspaceFolder) {
		void vscode.window.showInformationMessage('请先打开一个本地文件夹，再初始化 OI 项目配置。');
		return;
	}

	const configuredCompiler = vscode.workspace.getConfiguration('cph.language.cpp').get<string>('Command');
	const compiler = configuredCompiler || await findPreferredCompiler(loadPreset(context).compilerCandidates) || 'g++';
	createDefaultClangdProjectConfig(workspaceFolder.uri.fsPath, compiler, 'c++23');
	createDefaultClangFormatConfig(workspaceFolder.uri.fsPath);
	await context.workspaceState.update(OI_WORKSPACE_INITIALIZATION_DISMISSED, undefined);
	void vscode.window.showInformationMessage(`已在“${workspaceFolder.name}”中创建 .clangd 和 .clang-format。`);
}

async function offerOiWorkspaceInitialization(context: vscode.ExtensionContext): Promise<void> {
	const workspaceFolder = getSingleLocalWorkspaceFolder();
	if (!workspaceFolder || hasOiWorkspaceConfig(workspaceFolder) || context.workspaceState.get<boolean>(OI_WORKSPACE_INITIALIZATION_DISMISSED)) {
		return;
	}

	const action = await vscode.window.showInformationMessage(
		`“${workspaceFolder.name}”尚未包含 OI 项目配置。要创建 .clangd 和 .clang-format 吗？`,
		'初始化 OI 配置',
		'暂不初始化'
	);
	if (action === '初始化 OI 配置') {
		await initializeOiWorkspace(context);
	} else {
		await context.workspaceState.update(OI_WORKSPACE_INITIALIZATION_DISMISSED, true);
	}
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	registerSimpleSettings(context);
	registerRelaxMode(context);
	registerCphSettings(context);
	registerGettingStarted(context);
	registerToolchainDiagnostics(context);
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.setupEnvironment', () => runSetup(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.redetectToolchain', () => runSetup(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.repairToolchain', () => repairToolchain(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.rerunFirstRunSetup', () => rerunFirstRunSetup()));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.initializeOiWorkspace', () => initializeOiWorkspace(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.showAllFiles', toggleHiddenFiles));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.hideSetupFiles', toggleHiddenFiles));
	warnAboutPortablePathWithSpaces();
	await rebasePortableToolchain(context);
	if (!context.globalState.get<boolean>(FILE_EXCLUDES_MIGRATION)) {
		await ensureShortestPathFileExcludes();
		await context.globalState.update(FILE_EXCLUDES_MIGRATION, true);
	}
	if (!context.globalState.get<boolean>(OJ_MAPPING_MIGRATION)) {
		await ensureShortestPathOjMapping();
		await context.globalState.update(OJ_MAPPING_MIGRATION, true);
	}
	if (!context.globalState.get<boolean>(FILE_NAME_TEMPLATE_OVERRIDES_MIGRATION)) {
		await ensureShortestPathFileNameTemplateOverride();
		await context.globalState.update(FILE_NAME_TEMPLATE_OVERRIDES_MIGRATION, true);
	}
	const updateHiddenFilesContext = () => {
		void vscode.commands.executeCommand('setContext', 'shortestpath.showAllFiles', !hasShortestPathHiddenFiles());
	};
	updateHiddenFilesContext();
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('files.exclude')) {
			updateHiddenFilesContext();
		}
	}));
	let applyingPending = false;
	const applyPending = async () => {
		if (applyingPending) { return; }
		const pending = vscode.workspace.getConfiguration('shortestpath.setup').get<unknown>('pending');
		if (!isFirstRunSelection(pending)) { return; }
		applyingPending = true;
		try { await configure(context, pending); } finally { applyingPending = false; }
	};
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
		if (event.affectsConfiguration('shortestpath.setup.pending')) { void applyPending(); }
	}));
	await applyPending();
	void offerOiWorkspaceInitialization(context);
}

function warnAboutPortablePathWithSpaces(): void {
	if (process.platform !== 'win32' || !vscode.env.isAppPortable || !/\s/.test(vscode.env.appRoot)) {
		return;
	}
	void vscode.window.showWarningMessage('ShortestPath 所处运行路径包含空格，可能出现意外错误，开发者不会处理因包含空格而导致的 bug。');
}

async function ensureShortestPathOjMapping(): Promise<void> {
	const configuration = vscode.workspace.getConfiguration('cph.general', null);
	const globalValue = configuration.inspect<Record<string, unknown>>('ojMapping')?.globalValue;
	if (!globalValue) {
		return;
	}
	const existing = globalValue['shortestpath.cn'] as { oj?: string; ojName?: string } | undefined;
	if (existing && !(existing.oj === 'SP' && existing.ojName === 'ShortestPath OJ')) {
		return;
	}
	await configuration.update('ojMapping', { ...globalValue, 'shortestpath.cn': shortestPathOjMapping }, vscode.ConfigurationTarget.Global);
}

async function ensureShortestPathFileNameTemplateOverride(): Promise<void> {
	const configuration = vscode.workspace.getConfiguration('cph.general', null);
	const globalValue = configuration.inspect<Record<string, string>>('fileNameTemplateOverrides')?.globalValue;
	if (!globalValue || globalValue.ShortestPath) {
		return;
	}
	await configuration.update('fileNameTemplateOverrides', { ...globalValue, ShortestPath: '{ojName}/{contestId}/{problemId}.{ext}' }, vscode.ConfigurationTarget.Global);
}

async function rerunFirstRunSetup(): Promise<void> {
	const configuration = vscode.workspace.getConfiguration('shortestpath.setup');
	await configuration.update('pending', undefined, vscode.ConfigurationTarget.Global);
	await configuration.update('completed', false, vscode.ConfigurationTarget.Global);
	const action = await vscode.window.showInformationMessage(
		'ShortestPath IDE will show the first-run setup after restart.',
		'Restart Now'
	);
	if (action === 'Restart Now') {
		await vscode.commands.executeCommand('workbench.action.reloadWindow');
	}
}

async function repairToolchain(context: vscode.ExtensionContext): Promise<void> {
	const preset = loadPreset(context);
	if (preset.portableToolchain) {
		const configuration = vscode.workspace.getConfiguration('shortestpath.setup');
		await configuration.update('pending', undefined, vscode.ConfigurationTarget.Global);
		await configuration.update('completed', false, vscode.ConfigurationTarget.Global);
		await vscode.window.showInformationMessage('正在进入工具链修复。请在开箱页继续，ShortestPath IDE 会重新下载缺失的组件。');
		await vscode.commands.executeCommand('workbench.action.reloadWindow');
		return;
	}
	const compiler = await findPreferredCompiler(preset.compilerCandidates);
	const clangd = await findFirstExecutable(preset.clangdCandidates);
	if (compiler && clangd && !await isAppleClang(compiler)) {
		// Repair only toolchain-related settings; do not overwrite the user's editor
		// and CPH preferences with the first-run preset.
		const configuration = vscode.workspace.getConfiguration(undefined, null);
		const flags = configuration.get<string>('cph.language.cpp.Args')
			?? configuration.get<string>('c-cpp-compile-run.cpp-flags')
			?? '';
		const settings: Record<string, unknown> = {
			'cph.language.cpp.Command': compiler,
			'c-cpp-compile-run.cpp-compiler': compiler,
			'clangd.path': clangd,
			'clangd.arguments': clangdArgumentsForCompiler(compiler)
		};
		if (flags) {
			settings['cph.language.cpp.Args'] = flags;
			settings['c-cpp-compile-run.cpp-flags'] = flags;
		}
		await updateGlobalSettings(settings);
		return;
	}
	// A configured Apple Clang fallback is usable, but "repair" means install
	// Homebrew GCC rather than treating that fallback as already complete.
	await offerInstaller(context, preset, !compiler || await isAppleClang(compiler), !clangd);
}

async function runSetup(context: vscode.ExtensionContext): Promise<void> {
	await configure(context);
}

async function configure(context: vscode.ExtensionContext, firstRunSelection?: FirstRunSelection): Promise<void> {
	const preset = loadPreset(context);
	let compiler = await findPreferredCompiler(preset.compilerCandidates);
	let clangd = await findFirstExecutable(preset.clangdCandidates);
	let installerStarted = false;

	if (firstRunSelection) {
		if (firstRunSelection.installToolchain && (!compiler || !clangd)) {
			await offerInstaller(context, preset, !compiler, !clangd);
			installerStarted = true;
		}
	} else if (!compiler || !clangd) {
		await offerInstaller(context, preset, !compiler, !clangd);
		installerStarted = true;
	}

	if (installerStarted) {
		compiler = await findPreferredCompiler(preset.compilerCandidates);
		clangd = await findFirstExecutable(preset.clangdCandidates);
		if (preset.portableToolchain) {
			compiler ??= preset.compilerCandidates[0];
			clangd ??= preset.clangdCandidates[0];
		}
	}
	if (compiler && await isAppleClang(compiler)) {
		await vscode.window.showWarningMessage(
			'未检测到 Homebrew GCC，当前将使用 Apple Clang（g++ 兼容包装器）。它可以编译代码，但为保持竞赛环境一致，建议执行“修复工具链”安装 Homebrew GCC。',
			{ modal: true },
			'修复工具链',
			'继续使用 Apple Clang'
		).then(action => action === '修复工具链' ? repairToolchain(context) : undefined);
	}

	const settings: Record<string, unknown> = {
		'files.exclude': addMissingShortestPathFileExcludes(getGlobalFileExcludes())
	};
	const cppStandard = firstRunSelection?.cppStandard ?? 'c++23';
	if (compiler) {
		if (process.platform === 'win32' && vscode.env.isAppPortable) {
			compiler = getSpaceSafePortableCompilerPath(context, compiler);
		}
		const compilerFlags = [
			`-std=${cppStandard}`,
			'-O2',
			'-g',
			'-Wall',
			'-Wextra',
			'-D_GLIBCXX_DEBUG',
			...(process.platform === 'win32' ? ['-static'] : []),
		].join(' ');
		settings['cph.language.cpp.Command'] = compiler;
		settings['cph.language.cpp.Args'] = compilerFlags;
		settings['c-cpp-compile-run.output-location'] = '.';
		settings['c-cpp-compile-run.cpp-compiler'] = compiler;
		settings['c-cpp-compile-run.cpp-flags'] = compilerFlags;
		if (firstRunSelection) {
			createDefaultClangdProjectConfig(firstRunSelection.workspaceFolder, compiler, cppStandard);
		}
		settings['clangd.arguments'] = clangdArgumentsForCompiler(compiler);
	}
	if (clangd) {
		settings['clangd.path'] = clangd;
	}
	await updateGlobalSettings(settings);
	if (firstRunSelection) {
		const firstRunConfiguration = vscode.workspace.getConfiguration('shortestpath.setup');
		await firstRunConfiguration.update('pending', undefined, vscode.ConfigurationTarget.Global);
		await firstRunConfiguration.update('completed', true, vscode.ConfigurationTarget.Global);
	}
	await context.globalState.update(SETUP_COMPLETE, true);

	if (installerStarted && preset.portableToolchain) {
		void vscode.window.showInformationMessage('ShortestPath IDE is configured for its Portable toolchain. The download continues in the setup terminal without changing your system PATH.');
	} else if (!compiler || !clangd) {
		void vscode.window.showWarningMessage('The preset was saved, but one or more compilers are not installed yet. Finish the terminal installer, then run “ShortestPath IDE: Configure Competitive Programming Environment” again to detect their actual paths.');
	} else {
		void vscode.window.showInformationMessage(`ShortestPath IDE is ready. Using g++ at ${compiler}.`);
	}
}

async function rebasePortableToolchain(context: vscode.ExtensionContext): Promise<void> {
	if (process.platform !== 'win32' || !vscode.env.isAppPortable) {
		return;
	}

	const preset = loadPreset(context);
	const installedCompiler = preset.compilerCandidates[0];
	const clangd = preset.clangdCandidates[0];
	const compilerExists = fs.existsSync(installedCompiler);
	const compiler = compilerExists ? getSpaceSafePortableCompilerPath(context, installedCompiler) : installedCompiler;
	const clangdExists = fs.existsSync(clangd);
	const configuration = vscode.workspace.getConfiguration(undefined, null);
	const settings: Record<string, unknown> = {};

	if (compilerExists) {
		for (const key of ['cph.language.cpp.Command', 'c-cpp-compile-run.cpp-compiler']) {
			const value = configuration.inspect<string>(key)?.globalValue;
			if (value && rebaseManagedToolchainPath(value, compiler, clangd) === compiler && value !== compiler) {
				settings[key] = compiler;
			}
		}

		const argumentsValue = configuration.inspect<string[]>('clangd.arguments')?.globalValue;
		if (argumentsValue) {
			const rebasedArguments = argumentsValue.map(argument => rebaseManagedQueryDriver(argument, compiler));
			if (rebasedArguments.some((argument, index) => argument !== argumentsValue[index])) {
				settings['clangd.arguments'] = rebasedArguments;
			}
		}
	}

	if (clangdExists) {
		const value = configuration.inspect<string>('clangd.path')?.globalValue;
		if (value && rebaseManagedToolchainPath(value, compiler, clangd) === clangd && value !== clangd) {
			settings['clangd.path'] = clangd;
		}
	}

	await updateGlobalSettings(settings);
	await enableBundledConptyWhenUnset();
	if (!compilerExists) {
		return;
	}

	for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
		if (workspaceFolder.uri.scheme !== 'file') {
			continue;
		}
		const configPath = path.join(workspaceFolder.uri.fsPath, '.clangd');
		if (!fs.existsSync(configPath)) {
			continue;
		}
		const content = fs.readFileSync(configPath, 'utf8');
		const rebasedContent = rebaseGeneratedClangdConfig(content, compiler);
		if (rebasedContent !== content) {
			fs.writeFileSync(configPath, rebasedContent, 'utf8');
		}
	}
}

/**
 * Some MinGW distributions pass their derived libexec path to ld without
 * quoting it. Run through a no-space drive-root junction instead.
 */
function getSpaceSafePortableCompilerPath(context: vscode.ExtensionContext, compiler: string): string {
	if (!/\s/.test(compiler)) {
		return compiler;
	}
	const dataRoot = getPortableDataRoot(context.globalStorageUri.fsPath);
	if (!dataRoot) {
		return compiler;
	}
	const volumeRoot = path.parse(dataRoot).root;
	if (!volumeRoot) {
		return compiler;
	}
	const hash = createHash('sha256').update(dataRoot.toLowerCase()).digest('hex').slice(0, 12);
	const alias = path.join(volumeRoot, `.shortestpath-toolchain-${hash}`);
	try {
		if (fs.existsSync(alias)) {
			if (normalizeWindowsPath(fs.realpathSync(alias)) !== normalizeWindowsPath(dataRoot)) {
				return compiler;
			}
		} else {
			fs.symlinkSync(dataRoot, alias, 'junction');
		}
		return path.join(alias, path.relative(dataRoot, compiler));
	} catch {
		return compiler;
	}
}

function normalizeWindowsPath(value: string): string {
	return value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

async function enableBundledConptyWhenUnset(): Promise<void> {
	const configuration = vscode.workspace.getConfiguration(undefined, null);
	if (configuration.inspect<boolean>('terminal.integrated.windowsUseConptyDll')?.globalValue !== undefined) {
		return;
	}
	await configuration.update('terminal.integrated.windowsUseConptyDll', true, vscode.ConfigurationTarget.Global);
}

function isFirstRunSelection(candidate: unknown): candidate is FirstRunSelection {
	if (!candidate || typeof candidate !== 'object') {
		return false;
	}
	const value = candidate as Partial<FirstRunSelection>;
	return value.mode === 'recommended'
		&& typeof value.installToolchain === 'boolean'
		&& (value.cppStandard === 'c++11' || value.cppStandard === 'c++14' || value.cppStandard === 'c++17' || value.cppStandard === 'c++20' || value.cppStandard === 'c++23')
		&& typeof value.workspaceFolder === 'string'
		&& path.isAbsolute(value.workspaceFolder);
}

function loadPreset(context: vscode.ExtensionContext): PlatformPreset {
	const name = getPlatformName() + '.json';
	const preset = JSON.parse(fs.readFileSync(path.join(context.extensionPath, 'resources', name), 'utf8')) as PlatformPreset;
	const toolchainRoot = path.join(context.globalStorageUri.fsPath, 'toolchains');
	return {
		...preset,
		compilerCandidates: preset.compilerCandidates.map(candidate => candidate.replaceAll('{{TOOLCHAIN_ROOT}}', toolchainRoot)),
		clangdCandidates: preset.clangdCandidates.map(candidate => candidate.replaceAll('{{TOOLCHAIN_ROOT}}', toolchainRoot))
	};
}

function getPlatformName(): 'windows' | 'mac' | 'linux' {
	return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
}

function loadPlatformInstaller(context: vscode.ExtensionContext): PlatformInstaller {
	// Platform installers are plain CommonJS resources so the main-process first-run
	// window and this extension command execute the exact same platform logic.
	return require(path.join(context.extensionPath, 'resources', `${getPlatformName()}.js`)) as PlatformInstaller;
}

async function offerInstaller(context: vscode.ExtensionContext, preset: PlatformPreset, compilerMissing: boolean, clangdMissing: boolean): Promise<void> {
	const missingTools = [
		compilerMissing ? (process.platform === 'darwin' ? 'Homebrew GCC' : 'g++') : undefined,
		clangdMissing ? 'clangd' : undefined
	].filter((tool): tool is string => !!tool);
	const choice = await vscode.window.showWarningMessage(
		`未检测到 ${missingTools.join(' 和 ')}。${preset.installDescription}。安装命令会在集成终端中运行，可能需要管理员权限。`,
		{ modal: true },
		'安装并修复',
		'暂不处理'
	);
	if (choice === '安装并修复') {
		const toolchainRoot = path.join(context.globalStorageUri.fsPath, 'toolchains');
		const source = preset.downloadSources?.find(candidate => candidate.id === 'tuna' && !candidate.unavailable)
			?? preset.downloadSources?.find(candidate => !candidate.unavailable);
		const installer = loadPlatformInstaller(context);
		if (installer.getPortableAssets || !installer.createCommand) {
			const restart = await vscode.window.showInformationMessage(
				'Portable toolchains are downloaded by the first-run setup window. Restart setup to download them.',
				'Restart setup now'
			);
			if (restart === 'Restart setup now') {
				await rerunFirstRunSetup();
			}
			return;
		}
		const installCommand = process.platform === 'darwin'
			? `${installer.createCommand({ toolchainRoot, source, stage: 'xcode', locale: vscode.env.language })}; ${installer.createCommand({ toolchainRoot, source, stage: 'homebrew', locale: vscode.env.language })}; ${installer.createCommand({ toolchainRoot, source, stage: 'toolchain', locale: vscode.env.language })}`
			: installer.createCommand({ toolchainRoot, source, stage: 'toolchain', locale: vscode.env.language });
		const terminal = vscode.window.createTerminal('ShortestPath IDE Toolchain Setup');
		terminal.show();
		terminal.sendText(installCommand, true);
	}
}

async function updateGlobalSettings(settings: Record<string, unknown>): Promise<void> {
	for (const [key, value] of Object.entries(settings)) {
		await vscode.workspace.getConfiguration(undefined, null).update(key, value, vscode.ConfigurationTarget.Global);
	}
}

function getGlobalFileExcludes(): Record<string, boolean> {
	return vscode.workspace.getConfiguration('files', null).inspect<Record<string, boolean>>('exclude')?.globalValue ?? {};
}

function hasShortestPathHiddenFiles(): boolean {
	const excludes = vscode.workspace.getConfiguration('files', null).get<Record<string, boolean>>('exclude') ?? {};
	return Object.keys(shortestPathHiddenFiles).some(pattern => excludes[pattern] === true);
}

function addMissingShortestPathFileExcludes(excludes: Record<string, boolean>): Record<string, boolean> {
	const updatedExcludes = { ...excludes };
	for (const [pattern, excluded] of Object.entries(shortestPathHiddenFiles)) {
		if (!(pattern in updatedExcludes)) {
			updatedExcludes[pattern] = excluded;
		}
	}
	return updatedExcludes;
}

async function ensureShortestPathFileExcludes(): Promise<void> {
	const excludes = getGlobalFileExcludes();
	const updatedExcludes = addMissingShortestPathFileExcludes(excludes);
	if (Object.keys(updatedExcludes).length === Object.keys(excludes).length) {
		return;
	}
	await vscode.workspace.getConfiguration('files', null).update('exclude', updatedExcludes, vscode.ConfigurationTarget.Global);
}

async function toggleHiddenFiles(): Promise<void> {
	const excludes = { ...getGlobalFileExcludes() };
	if (hasShortestPathHiddenFiles()) {
		for (const pattern of Object.keys(shortestPathHiddenFiles)) {
			delete excludes[pattern];
		}
	} else {
		Object.assign(excludes, shortestPathHiddenFiles);
	}
	await vscode.workspace.getConfiguration('files', null).update('exclude', excludes, vscode.ConfigurationTarget.Global);
}

async function findFirstExecutable(candidates: readonly string[]): Promise<string | undefined> {
	for (const candidate of candidates) {
		if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
			return candidate;
		}
		const located = await locateOnPath(candidate);
		if (located) {
			return located;
		}
	}
	return undefined;
}

async function findPreferredCompiler(candidates: readonly string[]): Promise<string | undefined> {
	if (process.platform !== 'darwin') {
		return findFirstExecutable(candidates);
	}

	const brew = await locateOnPath('brew');
	const directories = ['/opt/homebrew/bin', '/usr/local/bin'];
	if (brew) {
		const prefix = await getHomebrewGccPrefix(brew);
		if (prefix) {
			// Prefer the executable that Homebrew exposes on PATH (`which g++-16`).
			// clangd's query-driver matching is path-sensitive, while the formula
			// prefix is an additional symlink that can differ from user config.
			directories.push(path.join(prefix, 'bin'));
		}
	}

	const matches = directories.flatMap(directory => {
		try {
			return fs.readdirSync(directory)
				.filter(name => /^g\+\+-\d+$/.test(name))
				.map(name => path.join(directory, name))
				.filter(candidate => fs.existsSync(candidate));
		} catch {
			return [];
		}
	});
	const homebrewGcc = matches.sort((left, right) => getGccVersion(right) - getGccVersion(left))[0];
	// macOS ships /usr/bin/g++ as an Apple Clang compatibility wrapper. It is a
	// usable fallback, but diagnostics and the setup warning make that explicit.
	return homebrewGcc ?? await findFirstExecutable(['/usr/bin/g++', '/usr/bin/clang++', 'g++', 'clang++']);
}

function getHomebrewGccPrefix(brew: string): Promise<string | undefined> {
	return new Promise(resolve => execFile(brew, ['--prefix', 'gcc'], { windowsHide: true }, (error, stdout) => resolve(error ? undefined : stdout.trim() || undefined)));
}

function getGccVersion(candidate: string): number {
	return Number(/g\+\+-(\d+)$/.exec(candidate)?.[1] ?? 0);
}

function isAppleClang(compiler: string): Promise<boolean> {
	return new Promise(resolve => execFile(compiler, ['--version'], { windowsHide: true }, (error, stdout, stderr) => {
		resolve(!error && /apple clang/i.test(`${stdout}\n${stderr}`));
	}));
}

function locateOnPath(command: string): Promise<string | undefined> {
	const locator = process.platform === 'win32' ? 'where.exe' : 'which';
	return new Promise(resolve => {
		execFile(locator, [command], { windowsHide: true }, (error, stdout) => {
			const result = error ? undefined : stdout.split(/\r?\n/, 1)[0]?.trim();
			resolve(result || undefined);
		});
	});
}
