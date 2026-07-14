import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';
import { execFile } from 'child_process';
import * as vscode from 'vscode';

type PlatformPreset = {
	portableToolchain: boolean;
	compilerCandidates: string[];
	clangdCandidates: string[];
	installDescription: string;
	downloadSources?: DownloadSource[];
};

type DownloadSource = { id: string; condaForgeChannel: string; msys2Channel?: string; unavailable?: boolean };

type PlatformInstaller = {
	createCommand?(input: { toolchainRoot: string; source?: DownloadSource; stage?: string; locale?: string }): string;
};

type SetupSelection = 'recommended' | 'custom';

type FirstRunSelection = {
	mode: SetupSelection;
	editor: boolean;
	cph: boolean;
	installToolchain: boolean;
	fontLigatures: boolean;
	fontSize: number;
	vjudgeOpenInBrowser: boolean;
	cppStandard: 'c++11' | 'c++14' | 'c++17' | 'c++20' | 'c++23';
	workspaceFolder: string;
};

const SETUP_COMPLETE = 'shortestpath.setupComplete';

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

const editorSettings: Record<string, unknown> = {
	'editor.fontFamily': "Fira Code, Menlo, Monaco, 'Courier New', monospace",
	'editor.fontLigatures': true,
	'editor.cursorSmoothCaretAnimation': 'on',
	'editor.smoothScrolling': true,
	'workbench.list.smoothScrolling': true,
	'terminal.integrated.smoothScrolling': true,
	'editor.cursorBlinking': 'smooth',
	'editor.fontSize': 14,
	'files.autoSave': 'onFocusChange',
	'editor.formatOnSave': false,
	'editor.formatOnPaste': true,
	'editor.mouseWheelZoom': true
};

const cphSettings: Record<string, unknown> = {
	'cph.general.defaultLanguage': 'cpp',
	'cph.general.collectProblemsInRoot': true,
	'c-cpp-compile-run.output-location': '.',
	'cph.general.vjudgeOpenInBrowser': true,
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
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.setupEnvironment', () => runSetup(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.rerunFirstRunSetup', () => rerunFirstRunSetup()));
	const pending = vscode.workspace.getConfiguration('shortestpath.setup').get<unknown>('pending');
	if (isFirstRunSelection(pending)) {
		await configure(context, pending.mode, pending);
	}
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

async function runSetup(context: vscode.ExtensionContext): Promise<void> {
	const choice = await vscode.window.showQuickPick([
		{ label: 'Recommended', description: 'Apply the full ShortestPath IDE competitive programming preset.' },
		{ label: 'Custom', description: 'Choose which settings and toolchain options to apply.' }
	], { placeHolder: 'Choose a ShortestPath IDE setup mode' });
	if (choice) {
		await configure(context, choice.label === 'Recommended' ? 'recommended' : 'custom');
	}
}

async function configure(context: vscode.ExtensionContext, selection: SetupSelection, firstRunSelection?: FirstRunSelection): Promise<void> {
	const preset = loadPreset(context);
	let compiler = await findFirstExecutable(preset.compilerCandidates);
	let clangd = await findFirstExecutable(preset.clangdCandidates);
	let installerStarted = false;
	let includeEditor = true;
	const includeCph = true;

	if (firstRunSelection) {
		includeEditor = firstRunSelection.editor;
		if (firstRunSelection.installToolchain && (!compiler || !clangd)) {
			await offerInstaller(context, preset);
			installerStarted = true;
		}
	} else if (selection === 'custom') {
		const toolchainChoice = await vscode.window.showQuickPick([
			{ label: 'Use detected compilers', description: compiler ? `g++: ${compiler}` : 'No g++ found; settings will be applied after installation.' },
			{ label: 'Download g++ and clangd', description: preset.installDescription },
			{ label: 'Enter compiler path manually', description: 'Use a compiler executable or command already available to you.' }
		], { placeHolder: 'Choose a toolchain option' });
		if (!toolchainChoice) {
			return;
		}
		if (toolchainChoice.label === 'Download g++ and clangd') {
			await offerInstaller(context, preset);
			installerStarted = true;
		} else if (toolchainChoice.label === 'Enter compiler path manually') {
			compiler = await vscode.window.showInputBox({ prompt: 'Path or command for g++', value: compiler ?? '' });
			clangd = await vscode.window.showInputBox({ prompt: 'Path or command for clangd (optional)', value: clangd ?? '' });
		}
		includeEditor = await askYesNo('Apply editor font, smooth scrolling, autosave, format-on-save, and zoom defaults?', true);
	} else if (!compiler || !clangd) {
		await offerInstaller(context, preset);
		installerStarted = true;
	}

	if (installerStarted) {
		compiler = await findFirstExecutable(preset.compilerCandidates);
		clangd = await findFirstExecutable(preset.clangdCandidates);
		if (preset.portableToolchain) {
			compiler ??= preset.compilerCandidates[0];
			clangd ??= preset.clangdCandidates[0];
		}
	}

	const settings: Record<string, unknown> = {};
	if (includeEditor) {
		Object.assign(settings, editorSettings);
		if (firstRunSelection) {
			settings['editor.fontLigatures'] = firstRunSelection.fontLigatures;
			settings['editor.fontSize'] = firstRunSelection.fontSize;
		}
	}
	if (includeCph) {
		Object.assign(settings, cphSettings);
		if (firstRunSelection) {
			settings['cph.general.vjudgeOpenInBrowser'] = firstRunSelection.vjudgeOpenInBrowser;
		}
	}
	const cppStandard = firstRunSelection?.cppStandard ?? 'c++23';
	if (compiler) {
		settings['cph.language.cpp.Command'] = compiler;
		settings['cph.language.cpp.Args'] = `-std=${cppStandard} -O2 -g -Wall -Wextra -Wpedantic -Wconversion -fsanitize=address,undefined -D_GLIBCXX_DEBUG`;
		settings['c-cpp-compile-run.cpp-compiler'] = compiler;
		settings['c-cpp-compile-run.cpp-flags'] = `-std=${cppStandard} -O2 -g -Wall -Wextra -Wpedantic -Wconversion -fsanitize=address,undefined -D_GLIBCXX_DEBUG`;
		createDefaultClangdUserConfig(compiler, cppStandard);
		if (firstRunSelection) {
			createDefaultClangdProjectConfig(firstRunSelection.workspaceFolder, compiler, cppStandard);
		}
		settings['clangd.arguments'] = ['--background-index', `--query-driver=${compiler}`];
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

function isFirstRunSelection(candidate: unknown): candidate is FirstRunSelection {
	if (!candidate || typeof candidate !== 'object') {
		return false;
	}
	const value = candidate as Partial<FirstRunSelection>;
	return (value.mode === 'recommended' || value.mode === 'custom')
		&& typeof value.editor === 'boolean'
		&& typeof value.cph === 'boolean'
		&& typeof value.installToolchain === 'boolean'
		&& typeof value.fontLigatures === 'boolean'
		&& typeof value.fontSize === 'number'
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

async function offerInstaller(context: vscode.ExtensionContext, preset: PlatformPreset): Promise<void> {
	const choice = await vscode.window.showWarningMessage(
		`g++ or clangd was not found. ${preset.installDescription}. The command will open in an integrated terminal and may ask for administrator credentials.`,
		'Open installer terminal',
		'Skip'
	);
	if (choice === 'Open installer terminal') {
		const toolchainRoot = path.join(context.globalStorageUri.fsPath, 'toolchains');
		const source = preset.downloadSources?.find(candidate => candidate.id === 'tuna' && !candidate.unavailable)
			?? preset.downloadSources?.find(candidate => !candidate.unavailable);
		const installer = loadPlatformInstaller(context);
		if (!installer.createCommand) {
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

async function askYesNo(message: string, defaultValue: boolean): Promise<boolean> {
	const choice = await vscode.window.showQuickPick([
		{ label: defaultValue ? 'Yes (recommended)' : 'Yes' },
		{ label: defaultValue ? 'No' : 'No (recommended)' }
	], { placeHolder: message });
	return choice?.label.startsWith('Yes') ?? defaultValue;
}

async function updateGlobalSettings(settings: Record<string, unknown>): Promise<void> {
	for (const [key, value] of Object.entries(settings)) {
		await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
	}
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

function locateOnPath(command: string): Promise<string | undefined> {
	const locator = process.platform === 'win32' ? 'where.exe' : 'which';
	return new Promise(resolve => {
		execFile(locator, [command], { windowsHide: true }, (error, stdout) => {
			const result = error ? undefined : stdout.split(/\r?\n/, 1)[0]?.trim();
			resolve(result || undefined);
		});
	});
}
