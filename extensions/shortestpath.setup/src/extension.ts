import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { registerSimpleSettings } from './simpleSettings';
import { registerCphSettings } from './cphSettings';
import { registerToolchainDiagnostics } from './toolchainDiagnostics';

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
	editor: boolean;
	cph: boolean;
	installToolchain: boolean;
	fontLigatures: boolean;
	fontSize: number;
	autoFormat: boolean;
	vjudgeOpenInBrowser: boolean;
	cppStandard: 'c++11' | 'c++14' | 'c++17' | 'c++20' | 'c++23';
	workspaceFolder: string;
};

const SETUP_COMPLETE = 'shortestpath.setupComplete';

const shortestPathHiddenFiles: Record<string, boolean> = {
	'**/.cph': true,
	'**/.clang-format': true,
	'**/.clangd': true,
	'**/*.exe': true,
	'**/.*': true
};

const FILE_EXCLUDES_MIGRATION = 'shortestpath.fileExcludes.v2';

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
	return `CompileFlags:
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

function clangdUserConfigPath(): string {
	if (process.platform === 'win32') {
		return path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'clangd', 'config.yaml');
	}
	if (process.platform === 'darwin') {
		return path.join(homedir(), 'Library', 'Preferences', 'clangd', 'config.yaml');
	}
	return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config'), 'clangd', 'config.yaml');
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

function createDefaultClangdUserConfig(compiler: string, cppStandard: FirstRunSelection['cppStandard']): void {
	createDefaultClangdConfig(clangdUserConfigPath(), compiler, cppStandard);
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

const editorSettings: Record<string, unknown> = {
	'editor.fontLigatures': false,
	'editor.cursorSmoothCaretAnimation': 'on',
	'editor.smoothScrolling': true,
	'workbench.list.smoothScrolling': true,
	'terminal.integrated.smoothScrolling': true,
	'editor.cursorBlinking': 'smooth',
	'editor.fontSize': 14,
	'files.autoSave': 'onFocusChange',
	'editor.formatOnSave': true,
	'editor.formatOnPaste': true,
	'editor.mouseWheelZoom': true,
	'window.systemColorTheme': 'auto',
};

const cphSettings: Record<string, unknown> = {
	'cph.general.defaultLanguage': 'cpp',
	'cph.general.collectProblemsInRoot': true,
	'c-cpp-compile-run.output-location': '.',
	'cph.general.vjudgeOpenInBrowser': false,
	'cph.general.vjudgeBrowserSplitRatio': 65,
	'cph.general.vjudgeUrlSuffix': '#author=translator:1281309:zh',
	'cph.general.vjudgeOjNames': {
		CodeForces: { urlTemplate: 'https://codeforces.com/problemset/problem/{contestId}/{problemId}', problemIdRegex: '^(\\d+)([A-Z]\\d*)$' },
		CF: { urlTemplate: 'https://codeforces.com/problemset/problem/{contestId}/{problemId}', problemIdRegex: '^(\\d+)([A-Z]\\d*)$' },
		AtCoder: { urlTemplate: 'https://atcoder.jp/contests/{contestId}/tasks/{contestId}_{problemId}', problemIdRegex: '^([a-z]+\\d+)_([a-z]\\d*)$' },
		Luogu: { urlTemplate: 'https://www.luogu.com.cn/problem/{problemId}' },
		'洛谷': { urlTemplate: 'https://www.luogu.com.cn/problem/{problemId}' },
		SPOJ: { urlTemplate: 'https://www.spoj.com/problems/{problemId}' },
		UVA: { urlTemplate: 'https://onlinejudge.org/index.php?option=com_onlinejudge&Itemid=8&page=show_problem&problem={problemId}' },
		HDU: { urlTemplate: 'https://acm.hdu.edu.cn/showproblem.php?pid={problemId}' },
		POJ: { urlTemplate: 'http://poj.org/problem?id={problemId}' },
		Bailian: { urlTemplate: 'http://bailian.openjudge.cn/practice/{problemId}' },
		CSES: { urlTemplate: 'https://cses.fi/problemset/task/{problemId}' },
		NowCoder: { urlTemplate: 'https://ac.nowcoder.com/acm/problem/{problemId}', problemIdRegex: '^(\\d+)$' },
		'牛客': { urlTemplate: 'https://ac.nowcoder.com/acm/problem/{problemId}' }
	},
	'cph.general.ojMapping': {
		'codeforces.com': { oj: 'CF', ojName: 'Codeforces', contestIdRegex: '(?:contest|gym|problemset\\/problem)\\/(\\d+)', problemIdRegex: '(?:contest|gym|problemset\\/problem)\\/\\d+\\/(\\w+)' },
		'atcoder.jp': { oj: 'AT', ojName: 'AtCoder', contestIdRegex: 'contests\\/(\\w+)\\/tasks\\/\\w+_\\w+', problemIdRegex: 'contests\\/\\w+\\/tasks\\/\\w+_(\\w+)' },
		'luogu.com.cn': { oj: 'LG', ojName: 'Luogu', problemIdRegex: 'problem\\/(\\w+)' },
		'open.kattis.com': { oj: 'Kattis', ojName: 'Kattis' },
		'codechef.com': { oj: 'CC', ojName: 'CodeChef' },
		'spoj.com': { oj: 'SPOJ', ojName: 'SPOJ' },
		'hackerrank.com': { oj: 'HR', ojName: 'HackerRank' },
		'hackerearth.com': { oj: 'HE', ojName: 'HackerEarth' },
		'leetcode.com': { oj: 'LC', ojName: 'LeetCode' },
		'acm.timus.ru': { oj: 'Timus', ojName: 'Timus' },
		'dmoj.ca': { oj: 'DMOJ', ojName: 'DMOJ' },
		'cses.fi': { oj: 'CSES', ojName: 'CSES', problemIdRegex: 'task\\/(\\d+)' },
		'usaco.org': { oj: 'USACO', ojName: 'USACO' },
		'lightoj.com': { oj: 'LOJ', ojName: 'LightOJ' },
		'eolymp.com': { oj: 'EOlymp', ojName: 'EOlymp' },
		'acm.hdu.edu.cn': { oj: 'HDU', ojName: 'HDU', problemIdRegex: '[?&]pid=(\\d+)' },
		'ac.nowcoder.com': { oj: '牛客', ojName: '牛客', problemIdRegex: 'problem\\/(\\d+)' }
	}
};

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	registerSimpleSettings(context);
	registerCphSettings(context);
	registerToolchainDiagnostics(context);
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.setupEnvironment', () => runSetup(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.redetectToolchain', () => runSetup(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.repairToolchain', () => repairToolchain(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.rerunFirstRunSetup', () => rerunFirstRunSetup()));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.showAllFiles', toggleHiddenFiles));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.hideSetupFiles', toggleHiddenFiles));
	if (!context.globalState.get<boolean>(FILE_EXCLUDES_MIGRATION)) {
		await ensureShortestPathFileExcludes();
		await context.globalState.update(FILE_EXCLUDES_MIGRATION, true);
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
		const configuration = vscode.workspace.getConfiguration();
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
	let includeEditor = true;
	const includeCph = true;

	if (firstRunSelection) {
		includeEditor = firstRunSelection.editor;
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

	const settings: Record<string, unknown> = {};
	if (includeEditor) {
		Object.assign(settings, editorSettings);
		if (firstRunSelection) {
			settings['editor.fontLigatures'] = firstRunSelection.fontLigatures;
			settings['editor.fontSize'] = firstRunSelection.fontSize;
			settings['editor.formatOnSave'] = firstRunSelection.autoFormat;
			settings['editor.formatOnPaste'] = firstRunSelection.autoFormat;
		}
	}
	if (includeCph) {
		Object.assign(settings, cphSettings);
		if (firstRunSelection) {
			settings['cph.general.vjudgeOpenInBrowser'] = firstRunSelection.vjudgeOpenInBrowser;
		}
	}
	settings['files.exclude'] = {
		...getGlobalFileExcludes(),
		...shortestPathHiddenFiles
	};
	const cppStandard = firstRunSelection?.cppStandard ?? 'c++23';
	if (compiler) {
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
		settings['c-cpp-compile-run.cpp-compiler'] = compiler;
		settings['c-cpp-compile-run.cpp-flags'] = compilerFlags;
		createDefaultClangdUserConfig(compiler, cppStandard);
		if (firstRunSelection) {
			createDefaultClangdProjectConfig(firstRunSelection.workspaceFolder, compiler, cppStandard);
		}
		settings['clangd.arguments'] = clangdArgumentsForCompiler(compiler);
	}
	if (clangd) {
		settings['clangd.path'] = clangd;
	}
	if (firstRunSelection?.autoFormat) {
		createDefaultClangFormatConfig(firstRunSelection.workspaceFolder);
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

function isFirstRunSelection(candidate: unknown): candidate is FirstRunSelection {
	if (!candidate || typeof candidate !== 'object') {
		return false;
	}
	const value = candidate as Partial<FirstRunSelection>;
	return value.mode === 'recommended'
		&& typeof value.editor === 'boolean'
		&& typeof value.cph === 'boolean'
		&& typeof value.installToolchain === 'boolean'
		&& typeof value.fontLigatures === 'boolean'
		&& typeof value.fontSize === 'number'
		&& typeof value.autoFormat === 'boolean'
		&& typeof value.vjudgeOpenInBrowser === 'boolean'
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
		await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
	}
}

function getGlobalFileExcludes(): Record<string, boolean> {
	return vscode.workspace.getConfiguration('files').inspect<Record<string, boolean>>('exclude')?.globalValue ?? {};
}

function hasShortestPathHiddenFiles(): boolean {
	const excludes = vscode.workspace.getConfiguration('files').get<Record<string, boolean>>('exclude') ?? {};
	return Object.keys(shortestPathHiddenFiles).some(pattern => excludes[pattern] === true);
}

async function ensureShortestPathFileExcludes(): Promise<void> {
	const excludes = getGlobalFileExcludes();
	if (Object.keys(shortestPathHiddenFiles).every(pattern => excludes[pattern] === true)) {
		return;
	}
	await vscode.workspace.getConfiguration('files').update('exclude', {
		...excludes,
		...shortestPathHiddenFiles
	}, vscode.ConfigurationTarget.Global);
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
	await vscode.workspace.getConfiguration('files').update('exclude', excludes, vscode.ConfigurationTarget.Global);
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
