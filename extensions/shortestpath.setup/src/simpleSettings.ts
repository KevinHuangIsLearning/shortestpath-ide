import * as vscode from 'vscode';

type CppStandard = 'c++11' | 'c++14' | 'c++17' | 'c++20' | 'c++23';

type ThemeOption = {
	id: string;
	label: string;
};

const defaultCompilerFlags = `-std=c++23 -O2 -g -Wall -Wextra -D_GLIBCXX_DEBUG${process.platform === 'win32' ? ' -static' : ''}`;

type SimpleSettingsState = {
	fontFamily: string;
	fontLigatures: boolean;
	fontSize: number;
	autoFormat: boolean;
	cppStandard: CppStandard;
	compilerFlags: string;
	clangdVariableTypeHints: boolean;
	executableCleanupEnabled: boolean;
	executableCleanupDelaySeconds: number;
	colorTheme: string;
	autoDetectColorScheme: boolean;
	autoSave: string;
	newFileDefaultLanguage: string;
	themes: ThemeOption[];
};

export function registerSimpleSettings(context: vscode.ExtensionContext): void {
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.openSettings', () => openSimpleSettings(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.configureCppSnippets', () => openCppSnippets(context)));
	context.subscriptions.push(vscode.commands.registerCommand('shortestpath.configureAutoFormat', () => openAutoFormatSettings()));
}

function defaultLanguageSnippets(language: string): string {
	return `{
	// Place your snippets for ${language} here. Each snippet is defined under a snippet name and has a prefix, body and
	// description. The prefix is what is used to trigger the snippet and the body will be expanded and inserted. Possible variables are:
	// $1, $2 for tab stops, $0 for the final cursor position, and \${1:label}, \${2:another} for placeholders. Placeholders with the
	// same ids are connected.
	// Example:
	// "Print to console": {
	// \t"prefix": "log",
	// \t"body": [
	// \t\t"console.log('$1');",
	// \t\t"$2"
	// \t],
	// \t"description": "Log output to console"
	// }
	//
	// You can also restrict snippets to specific files using include/exclude patterns:
	// "Test snippet": {
	// \t"prefix": "test",
	// \t"body": "test('$1', () => {\\n\\t$0\\n});",
	// \t"include": ["**/*.test.ts", "*.spec.ts"],
	// \t"exclude": ["**/temp/*.ts"],
	// \t"description": "Insert test block"
	// }
}`;
}

type SnippetEntry = {
	name: string;
	prefix: string;
	body: string;
	description: string;
	include: string;
	exclude: string;
};

type SnippetLanguage = {
	id: string;
	label: string;
};

type SnippetsState = {
	language: string;
	languages: readonly SnippetLanguage[];
	entries: readonly SnippetEntry[];
};

const snippetLanguageLabels: Record<string, string> = {
	c: 'C',
	cpp: 'C++',
	csharp: 'C#',
	go: 'Go',
	java: 'Java',
	javascript: 'JavaScript',
	python: 'Python',
	rust: 'Rust',
	typescript: 'TypeScript'
};

function getSnippetsFile(context: vscode.ExtensionContext, language: string): vscode.Uri {
	return vscode.Uri.joinPath(context.globalStorageUri, '..', '..', 'snippets', `${language}.json`);
}

async function ensureSnippetsFile(context: vscode.ExtensionContext, language: string): Promise<vscode.Uri> {
	const snippetsFile = getSnippetsFile(context, language);
	try {
		await vscode.workspace.fs.stat(snippetsFile);
	} catch {
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(context.globalStorageUri, '..', '..', 'snippets'));
		await vscode.workspace.fs.writeFile(snippetsFile, Buffer.from(defaultLanguageSnippets(language), 'utf8'));
	}
	return snippetsFile;
}

function parseJsonc(text: string): unknown {
	let result = '';
	let inString = false;
	let escaping = false;
	for (let index = 0; index < text.length; index++) {
		const character = text[index];
		if (inString) {
			result += character;
			if (escaping) {
				escaping = false;
			} else if (character === '\\') {
				escaping = true;
			} else if (character === '"') {
				inString = false;
			}
		} else if (character === '"') {
			inString = true;
			result += character;
		} else if (character === '/' && text[index + 1] === '/') {
			while (index < text.length && text[index] !== '\n') {
				index++;
			}
			result += '\n';
		} else if (character === '/' && text[index + 1] === '*') {
			index += 2;
			while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) {
				index++;
			}
			index++;
		} else {
			result += character;
		}
	}
	return JSON.parse(result);
}

async function readSnippets(context: vscode.ExtensionContext, language: string): Promise<SnippetEntry[]> {
	const snippetsFile = await ensureSnippetsFile(context, language);
	try {
		const parsed = parseJsonc(Buffer.from(await vscode.workspace.fs.readFile(snippetsFile)).toString('utf8'));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return [];
		}
		return Object.entries(parsed).flatMap(([name, value]) => {
			if (!value || typeof value !== 'object' || Array.isArray(value)) {
				return [];
			}
			const snippet = value as Record<string, unknown>;
			const prefix = Array.isArray(snippet.prefix) ? snippet.prefix.join(', ') : snippet.prefix;
			const body = Array.isArray(snippet.body) ? snippet.body.join('\n') : snippet.body;
			return [{ name, prefix: typeof prefix === 'string' ? prefix : '', body: typeof body === 'string' ? body : '', description: typeof snippet.description === 'string' ? snippet.description : '', include: Array.isArray(snippet.include) ? snippet.include.join(', ') : '', exclude: Array.isArray(snippet.exclude) ? snippet.exclude.join(', ') : '' }];
		});
	} catch {
		void vscode.window.showWarningMessage(`无法读取 ${language}.json。请检查 JSON 格式。`);
		return [];
	}
}

async function writeSnippets(context: vscode.ExtensionContext, language: string, entries: readonly SnippetEntry[]): Promise<void> {
	const snippets: Record<string, Record<string, unknown>> = {};
	for (const entry of entries) {
		const baseName = entry.name.trim() || 'Untitled Snippet';
		let name = baseName;
		let suffix = 2;
		while (snippets[name]) {
			name = `${baseName} ${suffix++}`;
		}
		const snippet: Record<string, unknown> = { prefix: entry.prefix.trim(), body: entry.body.split('\n') };
		if (entry.description.trim()) { snippet.description = entry.description.trim(); }
		const include = entry.include.split(',').map(value => value.trim()).filter(Boolean);
		if (include.length) { snippet.include = include; }
		const exclude = entry.exclude.split(',').map(value => value.trim()).filter(Boolean);
		if (exclude.length) { snippet.exclude = exclude; }
		snippets[name] = snippet;
	}
	await vscode.workspace.fs.writeFile(await ensureSnippetsFile(context, language), Buffer.from(`${JSON.stringify(snippets, undefined, '\t')}\n`, 'utf8'));
}

async function openCppSnippets(context: vscode.ExtensionContext): Promise<void> {
	const languages = (await vscode.languages.getLanguages())
		.map(id => ({ id, label: snippetLanguageLabels[id] ? `${snippetLanguageLabels[id]} (${id})` : id }))
		.sort((left, right) => left.label.localeCompare(right.label));
	const supportedLanguages = new Set(languages.map(language => language.id));
	const initialLanguage = supportedLanguages.has('cpp') ? 'cpp' : languages[0]?.id;
	if (!initialLanguage) {
		void vscode.window.showWarningMessage('未找到可配置代码片段的语言。');
		return;
	}
	const getState = async (language: string): Promise<SnippetsState> => ({ language, languages, entries: await readSnippets(context, language) });
	const isSupportedLanguage = (candidate: unknown): candidate is string => typeof candidate === 'string' && supportedLanguages.has(candidate);
	const panel = vscode.window.createWebviewPanel('shortestpath.cppSnippets', '代码模板', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
	panel.webview.html = getCppSnippetsHtml(await getState(initialLanguage));
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'save' && isSupportedLanguage(message.language) && Array.isArray(message.entries)) {
			await writeSnippets(context, message.language, message.entries as SnippetEntry[]);
		} else if (message?.type === 'selectLanguage' && isSupportedLanguage(message.language)) {
			await panel.webview.postMessage({ type: 'state', value: await getState(message.language) });
		} else if (message?.type === 'confirmDelete' && isSupportedLanguage(message.language) && typeof message.name === 'string') {
			const action = await vscode.window.showWarningMessage(
				`确定删除模板“${message.name || '未命名模板'}”吗？删除后会立即保存到 ${message.language}.json。`,
				{ modal: true },
				'删除模板'
			);
			if (action === '删除模板') {
				await panel.webview.postMessage({ type: 'deleteConfirmed', language: message.language });
			}
		} else if (message?.type === 'openJson' && isSupportedLanguage(message.language)) {
			await vscode.window.showTextDocument(await ensureSnippetsFile(context, message.language), { preview: false });
		}
	}, undefined, context.subscriptions);
}

type AutoFormatState = {
	enabled: boolean;
	basedOnStyle: string;
	allowShortIfStatementsOnASingleLine: string;
	allowShortLoopsOnASingleLine: boolean;
	allowShortBlocksOnASingleLine: boolean;
	allowShortFunctionsOnASingleLine: string;
	columnLimit: number;
	indentWidth: number;
	tabWidth: number;
	useTab: string;
	accessModifierOffset: number;
	breakBeforeBraces: string;
	alwaysBreakTemplateDeclarations: string;
	pointerAlignment: string;
	spacesBeforeTrailingComments: number;
	separateDefinitionBlocks: string;
	standard: string;
};

const defaultAutoFormatState: AutoFormatState = {
	enabled: false,
	basedOnStyle: 'Google',
	allowShortIfStatementsOnASingleLine: 'AllIfsAndElse',
	allowShortLoopsOnASingleLine: true,
	allowShortBlocksOnASingleLine: true,
	allowShortFunctionsOnASingleLine: 'Inline',
	columnLimit: 0,
	indentWidth: 4,
	tabWidth: 4,
	useTab: 'Never',
	accessModifierOffset: -2,
	breakBeforeBraces: 'Attach',
	alwaysBreakTemplateDeclarations: 'No',
	pointerAlignment: 'Left',
	spacesBeforeTrailingComments: 4,
	separateDefinitionBlocks: 'Always',
	standard: 'Latest'
};

function getAutoFormatWorkspaceFolder(): vscode.Uri | undefined {
	return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function readAutoFormatValue(content: string, key: string): string | undefined {
	const match = new RegExp(`^${key}:\\s*(.+?)\\s*(?:#.*)?$`, 'm').exec(content);
	return match?.[1]?.trim();
}

async function readAutoFormatState(workspaceFolder: vscode.Uri): Promise<AutoFormatState> {
	const state = { ...defaultAutoFormatState };
	state.enabled = vscode.workspace.getConfiguration('editor', null).get<boolean>('formatOnSave') === true
		&& vscode.workspace.getConfiguration('editor', null).get<boolean>('formatOnPaste') === true;
	try {
		const content = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(workspaceFolder, '.clang-format'))).toString('utf8');
		const stringKeys = [
			'basedOnStyle', 'allowShortIfStatementsOnASingleLine', 'allowShortFunctionsOnASingleLine', 'useTab',
			'breakBeforeBraces', 'alwaysBreakTemplateDeclarations', 'pointerAlignment', 'separateDefinitionBlocks', 'standard'
		] as const;
		const yamlKeys: Record<typeof stringKeys[number], string> = {
			basedOnStyle: 'BasedOnStyle', allowShortIfStatementsOnASingleLine: 'AllowShortIfStatementsOnASingleLine',
			allowShortFunctionsOnASingleLine: 'AllowShortFunctionsOnASingleLine', useTab: 'UseTab',
			breakBeforeBraces: 'BreakBeforeBraces', alwaysBreakTemplateDeclarations: 'AlwaysBreakTemplateDeclarations',
			pointerAlignment: 'PointerAlignment', separateDefinitionBlocks: 'SeparateDefinitionBlocks', standard: 'Standard'
		};
		for (const key of stringKeys) { state[key] = readAutoFormatValue(content, yamlKeys[key]) ?? state[key]; }
		const numberKeys = ['columnLimit', 'indentWidth', 'tabWidth', 'accessModifierOffset', 'spacesBeforeTrailingComments'] as const;
		const numberYamlKeys: Record<typeof numberKeys[number], string> = {
			columnLimit: 'ColumnLimit', indentWidth: 'IndentWidth', tabWidth: 'TabWidth',
			accessModifierOffset: 'AccessModifierOffset', spacesBeforeTrailingComments: 'SpacesBeforeTrailingComments'
		};
		for (const key of numberKeys) {
			const value = Number(readAutoFormatValue(content, numberYamlKeys[key]));
			if (Number.isFinite(value)) { state[key] = value; }
		}
		const booleanKeys = ['allowShortLoopsOnASingleLine', 'allowShortBlocksOnASingleLine'] as const;
		const booleanYamlKeys: Record<typeof booleanKeys[number], string> = {
			allowShortLoopsOnASingleLine: 'AllowShortLoopsOnASingleLine', allowShortBlocksOnASingleLine: 'AllowShortBlocksOnASingleLine'
		};
		for (const key of booleanKeys) {
			const value = readAutoFormatValue(content, booleanYamlKeys[key]);
			if (value === 'true' || value === 'false') { state[key] = value === 'true'; }
		}
	} catch {
		// A missing .clang-format simply uses ShortestPath IDE's defaults.
	}
	return state;
}

function autoFormatString(value: unknown, allowed: readonly string[], fallback: string): string {
	return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

function autoFormatNumber(value: unknown, fallback: number, minimum: number, maximum: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, Math.floor(value))) : fallback;
}

function normalizeAutoFormatState(value: Partial<AutoFormatState>): AutoFormatState {
	return {
		enabled: value.enabled === true,
		basedOnStyle: autoFormatString(value.basedOnStyle, ['Google', 'LLVM', 'Chromium', 'Mozilla', 'WebKit'], 'Google'),
		allowShortIfStatementsOnASingleLine: autoFormatString(value.allowShortIfStatementsOnASingleLine, ['Never', 'WithoutElse', 'OnlyFirstIf', 'AllIfsAndElse'], 'AllIfsAndElse'),
		allowShortLoopsOnASingleLine: value.allowShortLoopsOnASingleLine !== false,
		allowShortBlocksOnASingleLine: value.allowShortBlocksOnASingleLine !== false,
		allowShortFunctionsOnASingleLine: autoFormatString(value.allowShortFunctionsOnASingleLine, ['None', 'InlineOnly', 'Empty', 'Inline', 'All'], 'Inline'),
		columnLimit: autoFormatNumber(value.columnLimit, 0, 0, 10000),
		indentWidth: autoFormatNumber(value.indentWidth, 4, 1, 32),
		tabWidth: autoFormatNumber(value.tabWidth, 4, 1, 32),
		useTab: autoFormatString(value.useTab, ['Never', 'ForIndentation', 'ForContinuationAndIndentation', 'Always'], 'Never'),
		accessModifierOffset: autoFormatNumber(value.accessModifierOffset, -2, -32, 32),
		breakBeforeBraces: autoFormatString(value.breakBeforeBraces, ['Attach', 'Linux', 'Mozilla', 'Stroustrup', 'Allman', 'Whitesmiths', 'GNU', 'WebKit', 'Custom'], 'Attach'),
		alwaysBreakTemplateDeclarations: autoFormatString(value.alwaysBreakTemplateDeclarations, ['No', 'Yes', 'MultiLine'], 'No'),
		pointerAlignment: autoFormatString(value.pointerAlignment, ['Left', 'Right', 'Middle'], 'Left'),
		spacesBeforeTrailingComments: autoFormatNumber(value.spacesBeforeTrailingComments, 4, 0, 100),
		separateDefinitionBlocks: autoFormatString(value.separateDefinitionBlocks, ['Leave', 'Never', 'Always'], 'Always'),
		standard: autoFormatString(value.standard, ['Auto', 'c++03', 'c++11', 'c++14', 'c++17', 'c++20', 'Latest'], 'Latest')
	};
}

function serializeAutoFormat(state: AutoFormatState): string {
	return `BasedOnStyle: ${state.basedOnStyle}

# --- 行为：尽量允许一行写完 ---
AllowShortIfStatementsOnASingleLine: ${state.allowShortIfStatementsOnASingleLine}
AllowShortLoopsOnASingleLine: ${state.allowShortLoopsOnASingleLine}
AllowShortBlocksOnASingleLine: ${state.allowShortBlocksOnASingleLine}
AllowShortFunctionsOnASingleLine: ${state.allowShortFunctionsOnASingleLine}

# --- 行长（核心关键，不然上面全白给） ---
ColumnLimit: ${state.columnLimit}

# --- 缩进 ---
IndentWidth: ${state.indentWidth}
TabWidth: ${state.tabWidth}
UseTab: ${state.useTab}

# --- 访问修饰符 ---
AccessModifierOffset: ${state.accessModifierOffset}

# --- 大括号风格 ---
BreakBeforeBraces: ${state.breakBeforeBraces}
AlwaysBreakTemplateDeclarations: ${state.alwaysBreakTemplateDeclarations}

# --- 指针与注释 ---
PointerAlignment: ${state.pointerAlignment}
SpacesBeforeTrailingComments: ${state.spacesBeforeTrailingComments}

# --- 代码块间距 ---
SeparateDefinitionBlocks: ${state.separateDefinitionBlocks}

# --- 语言标准 ---
Standard: ${state.standard}
`;
}

async function openAutoFormatSettings(): Promise<void> {
	const workspaceFolder = getAutoFormatWorkspaceFolder();
	if (!workspaceFolder) {
		void vscode.window.showWarningMessage('请先打开一个工作目录，再配置自动格式化。');
		return;
	}
	const panel = vscode.window.createWebviewPanel('shortestpath.autoFormat', '自动格式化', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
	panel.webview.html = getAutoFormatHtml(await readAutoFormatState(workspaceFolder), workspaceFolder.fsPath);
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'save') {
			const state = normalizeAutoFormatState(message.value ?? {});
			await Promise.all([
				vscode.workspace.getConfiguration('editor', null).update('formatOnSave', state.enabled, vscode.ConfigurationTarget.Global),
				vscode.workspace.getConfiguration('editor', null).update('formatOnPaste', state.enabled, vscode.ConfigurationTarget.Global),
				vscode.workspace.fs.writeFile(vscode.Uri.joinPath(workspaceFolder, '.clang-format'), Buffer.from(serializeAutoFormat(state), 'utf8'))
			]);
		} else if (message?.type === 'openFile') {
			await vscode.window.showTextDocument(vscode.Uri.joinPath(workspaceFolder, '.clang-format'), { preview: false });
		}
	});
}

function openSimpleSettings(context: vscode.ExtensionContext): void {
	let isSaving = false;
	const panel = vscode.window.createWebviewPanel(
		'shortestpath.settings',
		'ShortestPath IDE 设置',
		vscode.ViewColumn.Active,
		{ enableScripts: true, retainContextWhenHidden: true }
	);
	panel.webview.html = getHtml(getState());
	panel.webview.onDidReceiveMessage(async message => {
		if (message?.type === 'save') {
			isSaving = true;
			try {
				await saveState(message.value);
			} finally {
				isSaving = false;
			}
		} else if (message?.type === 'advanced') {
			await vscode.commands.executeCommand('workbench.action.openSettings2');
		} else if (message?.type === 'snippets') {
			await vscode.commands.executeCommand('shortestpath.configureCppSnippets');
		} else if (message?.type === 'autoFormat') {
			await vscode.commands.executeCommand('shortestpath.configureAutoFormat');
		} else if (message?.type === 'toolchainDiagnostics') {
			await vscode.commands.executeCommand('shortestpath.openToolchainDiagnostics');
		} else if (message?.type === 'cphSettings') {
			await vscode.commands.executeCommand('shortestpath.configureCph');
		}
	}, undefined, context.subscriptions);
	const configurationListener = vscode.workspace.onDidChangeConfiguration(event => {
		if (!isSaving && (event.affectsConfiguration('editor.fontFamily')
			|| event.affectsConfiguration('editor.fontLigatures')
			|| event.affectsConfiguration('editor.fontSize')
			|| event.affectsConfiguration('editor.formatOnSave')
			|| event.affectsConfiguration('editor.formatOnPaste')
			|| event.affectsConfiguration('cph.language.cpp.Args')
			|| event.affectsConfiguration('c-cpp-compile-run.cpp-flags')
			|| event.affectsConfiguration('editor.inlayHints.enabled')
			|| event.affectsConfiguration('shortestpath.executableCleanupEnabled')
			|| event.affectsConfiguration('shortestpath.executableCleanupDelaySeconds')
			|| event.affectsConfiguration('workbench.colorTheme')
			|| event.affectsConfiguration('window.autoDetectColorScheme')
			|| event.affectsConfiguration('files.autoSave'))) {
			void panel.webview.postMessage({ type: 'state', value: getState() });
		}
	});
	panel.onDidDispose(() => configurationListener.dispose(), undefined, context.subscriptions);
}

function getState(): SimpleSettingsState {
	const editor = vscode.workspace.getConfiguration('editor', null);
	const files = vscode.workspace.getConfiguration('files', null);
	const workbench = vscode.workspace.getConfiguration('workbench', null);
	const windowConfiguration = vscode.workspace.getConfiguration('window', null);
	const cphFlags = vscode.workspace.getConfiguration('cph.language.cpp', null).get<string>('Args');
	const compileRunFlags = vscode.workspace.getConfiguration('c-cpp-compile-run', null).get<string>('cpp-flags');
	const compilerFlags = cphFlags || compileRunFlags || defaultCompilerFlags;
	const inlayHintsEnabled = editor.get<boolean | string>('inlayHints.enabled') ?? 'on';
	const executableCleanupEnabled = vscode.workspace.getConfiguration('shortestpath', null).get<boolean>('executableCleanupEnabled') ?? true;
	const executableCleanupDelaySeconds = vscode.workspace.getConfiguration('shortestpath', null).get<number>('executableCleanupDelaySeconds') ?? 60;
	const colorTheme = workbench.get<string>('colorTheme') ?? 'Default Dark Modern';
	return {
		fontFamily: editor.get<string>('fontFamily') ?? '',
		fontLigatures: editor.get<boolean | string>('fontLigatures') === true || editor.get<boolean | string>('fontLigatures') === 'true',
		fontSize: editor.get<number>('fontSize') ?? 14,
		autoFormat: editor.get<boolean>('formatOnSave') === true && editor.get<boolean>('formatOnPaste') === true,
		cppStandard: findCppStandard(compilerFlags),
		compilerFlags,
		clangdVariableTypeHints: inlayHintsEnabled !== false && inlayHintsEnabled !== 'off',
		executableCleanupEnabled,
		executableCleanupDelaySeconds,
		colorTheme,
		autoDetectColorScheme: windowConfiguration.get<boolean>('autoDetectColorScheme') ?? false,
		autoSave: files.get<string>('autoSave') ?? 'off',
		newFileDefaultLanguage: vscode.workspace.getConfiguration('shortestpath.newFile', null).get<string>('defaultLanguage') ?? 'cpp',
		themes: getThemeOptions(colorTheme)
	};
}

function getThemeOptions(currentTheme: string): ThemeOption[] {
	const themes = new Map<string, string>([[currentTheme, currentTheme]]);
	for (const extension of vscode.extensions.all) {
		const contributedThemes = extension.packageJSON?.contributes?.themes;
		if (!Array.isArray(contributedThemes)) {
			continue;
		}
		for (const theme of contributedThemes) {
			if (typeof theme?.id === 'string') {
				themes.set(theme.id, typeof theme.label === 'string' ? theme.label : theme.id);
			}
		}
	}
	return [...themes].map(([id, label]) => ({ id, label })).sort((left, right) => left.label.localeCompare(right.label));
}

function findCppStandard(flags: string): CppStandard {
	const match = /-std=(?:gnu\+\+|c\+\+)(11|14|17|20|23)\b/.exec(flags);
	return match ? `c++${match[1]}` as CppStandard : 'c++23';
}

function applyCppStandard(flags: string, cppStandard: CppStandard): string {
	const withoutStandard = flags.replace(/(^|\s)-std=(?:gnu\+\+|c\+\+)\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
	return `-std=${cppStandard}${withoutStandard ? ` ${withoutStandard}` : ''}`;
}

async function saveState(value: Partial<SimpleSettingsState>): Promise<void> {
	const cppStandard = isCppStandard(value.cppStandard) ? value.cppStandard : 'c++23';
	const compilerFlags = applyCppStandard(typeof value.compilerFlags === 'string' ? value.compilerFlags : '', cppStandard);
	const executableCleanupDelaySeconds = typeof value.executableCleanupDelaySeconds === 'number'
		? Math.max(0, Math.min(86_400, Math.floor(value.executableCleanupDelaySeconds)))
		: 60;
	const settings = vscode.workspace.getConfiguration(undefined, null);
	await Promise.all([
		settings.update('editor.fontFamily', typeof value.fontFamily === 'string' ? value.fontFamily : '', vscode.ConfigurationTarget.Global),
		settings.update('editor.fontLigatures', value.fontLigatures === true, vscode.ConfigurationTarget.Global),
		settings.update('editor.fontSize', typeof value.fontSize === 'number' && value.fontSize > 0 ? value.fontSize : 14, vscode.ConfigurationTarget.Global),
		settings.update('editor.formatOnSave', value.autoFormat === true, vscode.ConfigurationTarget.Global),
		settings.update('editor.formatOnPaste', value.autoFormat === true, vscode.ConfigurationTarget.Global),
		settings.update('cph.language.cpp.Args', compilerFlags, vscode.ConfigurationTarget.Global),
		settings.update('c-cpp-compile-run.cpp-flags', compilerFlags, vscode.ConfigurationTarget.Global),
		settings.update('editor.inlayHints.enabled', value.clangdVariableTypeHints !== false ? 'on' : 'off', vscode.ConfigurationTarget.Global),
		settings.update('shortestpath.executableCleanupEnabled', value.executableCleanupEnabled !== false, vscode.ConfigurationTarget.Global),
		settings.update('shortestpath.executableCleanupDelaySeconds', executableCleanupDelaySeconds, vscode.ConfigurationTarget.Global),
		settings.update('workbench.colorTheme', typeof value.colorTheme === 'string' ? value.colorTheme : 'Default Dark Modern', vscode.ConfigurationTarget.Global),
		settings.update('window.autoDetectColorScheme', value.autoDetectColorScheme === true, vscode.ConfigurationTarget.Global),
		settings.update('window.systemColorTheme', 'auto', vscode.ConfigurationTarget.Global),
		settings.update('files.autoSave', typeof value.autoSave === 'string' ? value.autoSave : 'off', vscode.ConfigurationTarget.Global),
		settings.update('shortestpath.newFile.defaultLanguage', typeof value.newFileDefaultLanguage === 'string' && value.newFileDefaultLanguage ? value.newFileDefaultLanguage : 'cpp', vscode.ConfigurationTarget.Global)
	]);
}

function isCppStandard(value: unknown): value is CppStandard {
	return value === 'c++11' || value === 'c++14' || value === 'c++17' || value === 'c++20' || value === 'c++23';
}

function getHtml(state: SimpleSettingsState): string {
	const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>ShortestPath IDE 设置</title>
<style>
body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); margin: 0; height: 100vh; overflow: hidden; }
main { box-sizing: border-box; display: grid; grid-template-columns: 190px minmax(0, 760px); gap: 34px; height: 100vh; max-width: 1010px; margin: 0 auto; padding: 32px 28px; }
.sidebar { align-self: start; padding-top: 8px; }.sidebar-title { font-size: 15px; font-weight: 700; margin-bottom: 12px; }.settings-search { margin-bottom: 12px; }.categories { display: grid; gap: 3px; }.category { width: 100%; border: 0; border-radius: 4px; padding: 7px 9px; color: var(--vscode-foreground); background: transparent; text-align: left; font: inherit; cursor: pointer; }.category:hover, .category.active { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }.settings-content { min-width: 0; overflow-y: auto; padding-right: 4px; }
h1 { font-size: 28px; margin: 0 0 8px; } p { color: var(--vscode-descriptionForeground); margin: 0 0 28px; }
.card { border: 1px solid var(--vscode-editorWidget-border); border-radius: 8px; padding: 4px 20px; margin: 14px 0; }
.row { display: grid; grid-template-columns: 190px 1fr; gap: 18px; align-items: center; padding: 15px 0; border-bottom: 1px solid var(--vscode-editorWidget-border); }
.row:last-child { border: 0; } label { font-weight: 600; } .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
input, select { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 7px 9px; border-radius: 3px; font: inherit; }
input[type="checkbox"] { width: auto; transform: scale(1.15); } .toggle { display: flex; align-items: center; gap: 10px; }
.font-preview { color: var(--vscode-editor-foreground); background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-editorWidget-border); border-radius: 4px; font-size: 16px; line-height: 1.65; margin: -4px 0 14px 208px; padding: 10px 12px; white-space: pre; }
.fallback-list { display: grid; gap: 7px; }.fallback-row { display: grid; grid-template-columns: 1fr auto auto auto; gap: 6px; align-items: center; }.fallback-row .icon { min-width: 28px; padding: 5px; }.add-fallback { margin-top: 8px; }
.actions { display: flex; align-items: center; gap: 12px; margin-top: 24px; } button { border: 0; border-radius: 3px; padding: 8px 14px; font: inherit; cursor: pointer; color: var(--vscode-button-foreground); background: var(--vscode-button-background); } button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); } #saved { color: var(--vscode-testing-iconPassed); }
section.card[hidden], .row[hidden] { display: none; } .no-results { color: var(--vscode-descriptionForeground); margin: 28px 0; } @media (max-width: 720px) { body { height: auto; overflow: auto; } main { display: block; height: auto; padding: 24px 18px 48px; }.sidebar { position: static; margin-bottom: 22px; }.settings-content { overflow: visible; padding-right: 0; }.categories { grid-template-columns: repeat(2, minmax(0, 1fr)); }.row { grid-template-columns: 1fr; gap: 8px; }.font-preview { margin-left: 0; } }
</style>
</head>
<body><main>
<aside class="sidebar"><div class="sidebar-title">设置</div><input id="settingsSearch" class="settings-search" type="search" placeholder="搜索设置"><nav class="categories" aria-label="设置分类"><button class="category active" data-category="all">全部</button><button class="category" data-category="editor">编辑器</button><button class="category" data-category="cpp">C++ 与 clangd</button><button class="category" data-category="appearance">外观与保存</button><button class="category" data-category="tools">工具</button></nav></aside>
<div class="settings-content">
<h1>ShortestPath IDE 设置</h1><p>只保留竞赛编程常用选项。更改会自动保存；其他设置可在高级设置中调整。</p>
<section class="card" data-category="editor">
<div class="row"><div><label for="fontFamily">代码字体</label><div class="hint">首选字体仅列出等宽字体。</div></div><select id="fontFamily"></select></div>
<div id="fontPreview" class="font-preview">#include &lt;bits/stdc++.h&gt;
int main() { std::cout &lt;&lt; "Hello, OI!"; }</div>
<div class="row"><div><label>回退字体</label><div class="hint">字形缺失时按顺序回退；可选择非等宽中文或 Emoji 字体。</div></div><div><div id="fallbackFonts" class="fallback-list"></div><button id="addFallback" class="secondary add-fallback" type="button">添加回退字体</button></div></div>
<div class="row"><div><label for="fontLigatures">启用字体连字</label></div><label class="toggle"><input id="fontLigatures" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label for="fontSize">字体大小</label></div><input id="fontSize" type="number" min="1" step="1"></div>
<div class="row"><div><label for="newFileDefaultLanguage">新建文件默认语言</label><div class="hint">从 New Tab 新建文件时默认使用的语言。</div></div><select id="newFileDefaultLanguage"><option value="cpp">C++</option><option value="c">C</option><option value="python">Python</option><option value="java">Java</option><option value="rust">Rust</option><option value="javascript">JavaScript</option><option value="typescript">TypeScript</option></select></div>
</section>
<section class="card" data-category="cpp">
<div class="row"><div><label for="autoFormat">启用自动格式化</label><div class="hint">同时控制保存时格式化和粘贴时格式化。</div></div><label class="toggle"><input id="autoFormat" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label>自动格式化规则</label><div class="hint">配置当前工作目录的 .clang-format。</div></div><button id="autoFormatSettings" class="secondary">配置格式化规则</button></div>
</section>
<section class="card" data-category="cpp">
<div class="row"><div><label for="cppStandard">C++ 版本</label></div><select id="cppStandard"><option>c++11</option><option>c++14</option><option>c++17</option><option>c++20</option><option>c++23</option></select></div>
<div class="row"><div><label for="compilerFlags">编译选项</label><div class="hint">同时应用到 CPH 和 C/C++ Compile Run。</div></div><input id="compilerFlags" type="text"></div>
<div class="row"><div><label for="clangdVariableTypeHints">clangd 变量类型提示</label><div class="hint">在 auto 等推断变量后显示类型；此开关使用 VS Code 的内嵌提示设置。</div></div><label class="toggle"><input id="clangdVariableTypeHints" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label for="executableCleanupEnabled">自动清理生成文件</label><div class="hint">同时作用于 CPH 和 C/C++ Compile Run。</div></div><label class="toggle"><input id="executableCleanupEnabled" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label for="executableCleanupDelaySeconds">生成文件保留时间</label><div class="hint">程序运行结束后自动删除 exe。单位：秒；0 表示立即删除。</div></div><input id="executableCleanupDelaySeconds" type="number" min="0" max="86400" step="1"></div>
</section>
<section class="card" data-category="appearance">
<div class="row"><div><label for="colorTheme">主题</label></div><select id="colorTheme"></select></div>
<div class="row"><div><label for="autoDetectColorScheme">同步系统主题</label></div><label class="toggle"><input id="autoDetectColorScheme" type="checkbox"><span>启用</span></label></div>
<div class="row"><div><label for="autoSave">自动保存</label></div><select id="autoSave"><option value="off">关闭</option><option value="afterDelay">延迟后自动保存</option><option value="onFocusChange">切换焦点时保存</option><option value="onWindowChange">切换窗口时保存</option></select></div>
</section>
<section class="card" data-category="tools"><div class="row"><div><label>代码模板</label><div class="hint">配置 C++ 用户代码片段。</div></div><button id="snippets" class="secondary">配置代码模板</button></div></section>
<section class="card" data-category="tools"><div class="row"><div><label>CPH 设置</label><div class="hint">配置题目下载、Judge、VJudge 与 CPH 编译运行行为。</div></div><button id="cphSettings" class="secondary">配置 CPH</button></div></section>
<section class="card" data-category="tools"><div class="row"><div><label>工具链诊断</label><div class="hint">检查 CPH、Compile Run、clangd 与编译器是否可用且配置一致。</div></div><button id="toolchainDiagnostics" class="secondary">打开诊断页</button></div></section>
<p id="noResults" class="no-results" hidden>没有匹配的设置。</p>
<div class="actions"><button id="advanced" class="secondary">高级设置</button><span id="saved" aria-live="polite"></span></div>
</div>
</main>
<script>
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const monospaceFonts = ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Cascadia Mono', 'Consolas', 'Menlo', 'Monaco', 'SF Mono', 'Source Code Pro', 'Ubuntu Mono', 'Roboto Mono', 'Iosevka', 'Hack', 'Inconsolata', 'DejaVu Sans Mono', 'Courier New', 'monospace'];
const fallbackFonts = ['PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', 'Segoe UI Emoji', 'Apple Color Emoji', 'Noto Color Emoji', 'sans-serif'];
let selectedFonts = [];
let selectedCategory = 'all';
const normalizeFont = font => font.trim().replace(/^['"]|['"]$/g, '');
const serializeFontStack = fonts => fonts.map(font => font === 'monospace' ? font : /\s/.test(font) ? '"' + font + '"' : font).join(', ');
function updateSettingsFilter() {
  const search = byId('settingsSearch').value.trim().toLocaleLowerCase();
  let visibleRows = 0;
  document.querySelectorAll('section.card[data-category]').forEach(card => {
    const categoryMatches = selectedCategory === 'all' || card.dataset.category === selectedCategory;
    let cardHasVisibleRow = false;
    card.querySelectorAll('.row').forEach(row => {
      const searchMatches = !search || row.textContent.toLocaleLowerCase().includes(search);
      const visible = categoryMatches && searchMatches;
      row.hidden = !visible;
      cardHasVisibleRow ||= visible;
      if (visible) visibleRows++;
    });
    card.hidden = !cardHasVisibleRow;
  });
  byId('noResults').hidden = visibleRows > 0;
}
function setPreview() { byId('fontPreview').style.fontFamily = serializeFontStack(selectedFonts); }
function addOptions(select, fonts, label) { const group = document.createElement('optgroup'); group.label = label; fonts.forEach(font => { const option = document.createElement('option'); option.value = font; option.textContent = font; option.style.fontFamily = serializeFontStack([font]); group.append(option); }); select.append(group); }
function fontSelect(font, allowFallback) { const select = document.createElement('select'); addOptions(select, monospaceFonts, '等宽字体'); if (allowFallback) addOptions(select, fallbackFonts, '回退字体（可非等宽）'); if (![...select.options].some(option => option.value === font)) { const custom = document.createElement('option'); custom.value = font; custom.textContent = font + '（当前自定义字体）'; select.prepend(custom); } select.value = font; select.style.fontFamily = serializeFontStack([font]); return select; }
function renderFonts() {
  const primary = byId('fontFamily'); primary.replaceChildren();
  const primarySelect = fontSelect(selectedFonts[0], false); [...primarySelect.children].forEach(child => primary.append(child)); primary.value = selectedFonts[0]; primary.style.fontFamily = serializeFontStack([selectedFonts[0]]);
  const fallback = byId('fallbackFonts'); fallback.replaceChildren();
  selectedFonts.slice(1).forEach((font, index) => { const row = document.createElement('div'); row.className = 'fallback-row'; const select = fontSelect(font, true); select.onchange = () => { selectedFonts[index + 1] = select.value; renderFonts(); setPreview(); save(0); }; const up = document.createElement('button'); up.type = 'button'; up.className = 'secondary icon'; up.textContent = '↑'; up.disabled = index === 0; up.onclick = () => { [selectedFonts[index], selectedFonts[index + 1]] = [selectedFonts[index + 1], selectedFonts[index]]; renderFonts(); setPreview(); save(0); }; const down = document.createElement('button'); down.type = 'button'; down.className = 'secondary icon'; down.textContent = '↓'; down.disabled = index === selectedFonts.length - 2; down.onclick = () => { [selectedFonts[index + 1], selectedFonts[index + 2]] = [selectedFonts[index + 2], selectedFonts[index + 1]]; renderFonts(); setPreview(); save(0); }; const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary icon'; remove.textContent = '×'; remove.onclick = () => { selectedFonts.splice(index + 1, 1); renderFonts(); setPreview(); save(0); }; row.append(select, up, down, remove); fallback.append(row); });
}
function apply(state) {
  selectedFonts = (state.fontFamily || '').split(',').map(normalizeFont).filter(Boolean);
  if (!selectedFonts.length) selectedFonts = ['Consolas', 'monospace'];
  byId('fontLigatures').checked = !!state.fontLigatures;
  byId('fontSize').value = state.fontSize;
	byId('autoFormat').checked = !!state.autoFormat;
  byId('cppStandard').value = state.cppStandard;
  byId('compilerFlags').value = state.compilerFlags;
  byId('clangdVariableTypeHints').checked = !!state.clangdVariableTypeHints;
  byId('executableCleanupEnabled').checked = !!state.executableCleanupEnabled;
  byId('executableCleanupDelaySeconds').value = state.executableCleanupDelaySeconds;
  const theme = byId('colorTheme'); theme.replaceChildren();
  state.themes.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; theme.append(option); });
  theme.value = state.colorTheme;
  byId('autoDetectColorScheme').checked = !!state.autoDetectColorScheme;
  byId('autoSave').value = state.autoSave;
	byId('newFileDefaultLanguage').value = state.newFileDefaultLanguage;
  setPreview(); renderFonts();
}
function value() { return { fontFamily: serializeFontStack(selectedFonts), fontLigatures: byId('fontLigatures').checked, fontSize: Number(byId('fontSize').value), autoFormat: byId('autoFormat').checked, cppStandard: byId('cppStandard').value, compilerFlags: byId('compilerFlags').value, clangdVariableTypeHints: byId('clangdVariableTypeHints').checked, executableCleanupEnabled: byId('executableCleanupEnabled').checked, executableCleanupDelaySeconds: Number(byId('executableCleanupDelaySeconds').value), colorTheme: byId('colorTheme').value, autoDetectColorScheme: byId('autoDetectColorScheme').checked, autoSave: byId('autoSave').value, newFileDefaultLanguage: byId('newFileDefaultLanguage').value }; }
let saveTimer;
function save(delay) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { vscode.postMessage({ type: 'save', value: value() }); byId('saved').textContent = '已自动保存'; setTimeout(() => byId('saved').textContent = '', 1200); }, delay); }
document.querySelectorAll('input:not(#settingsSearch), select').forEach(control => {
  const immediate = control.type === 'checkbox' || control.tagName === 'SELECT';
  control.addEventListener('input', () => save(immediate ? 0 : 250));
  control.addEventListener('change', () => save(0));
});
byId('fontFamily').addEventListener('change', () => { selectedFonts[0] = byId('fontFamily').value; setPreview(); save(0); });
byId('addFallback').addEventListener('click', () => { selectedFonts.push(fallbackFonts[0]); renderFonts(); setPreview(); save(0); });
byId('cppStandard').addEventListener('change', () => { const flags = byId('compilerFlags'); const standard = byId('cppStandard').value; const withoutStandard = flags.value.replace(/(^|\\s)-std=(?:gnu\\+\\+|c\\+\\+)\\d+\\b/g, ' ').replace(/\\s+/g, ' ').trim(); flags.value = '-std=' + standard + (withoutStandard ? ' ' + withoutStandard : ''); save(0); });
document.querySelectorAll('.category').forEach(button => button.addEventListener('click', () => { selectedCategory = button.dataset.category; document.querySelectorAll('.category').forEach(item => item.classList.toggle('active', item === button)); updateSettingsFilter(); }));
byId('settingsSearch').addEventListener('input', updateSettingsFilter);
byId('advanced').addEventListener('click', () => vscode.postMessage({ type: 'advanced' }));
byId('snippets').addEventListener('click', () => vscode.postMessage({ type: 'snippets' }));
byId('autoFormatSettings').addEventListener('click', () => vscode.postMessage({ type: 'autoFormat' }));
byId('cphSettings').addEventListener('click', () => vscode.postMessage({ type: 'cphSettings' }));
byId('toolchainDiagnostics').addEventListener('click', () => vscode.postMessage({ type: 'toolchainDiagnostics' }));
window.addEventListener('message', event => { if (event.data?.type === 'state') apply(event.data.value); });
apply(${serializedState});
updateSettingsFilter();
</script></body></html>`;
}

function getAutoFormatHtml(state: AutoFormatState, workspacePath: string): string {
	const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');
	const serializedWorkspacePath = JSON.stringify(workspacePath).replace(/</g, '\\u003c');
	return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>自动格式化</title><style>
body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); }
main { max-width: 800px; margin: 0 auto; padding: 40px 28px 64px 250px; } .settings-sidebar { position: fixed; top: 28px; left: max(18px, calc(50vw - 505px)); width: 190px; }.settings-sidebar strong { display: block; margin-bottom: 12px; }.settings-sidebar input { margin-bottom: 10px; }.settings-sidebar nav { display: grid; gap: 3px; }.settings-sidebar button { text-align: left; padding: 7px 9px; background: transparent; color: var(--vscode-foreground); }.settings-sidebar button.active, .settings-sidebar button:hover { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.card { border: 1px solid var(--vscode-editorWidget-border); border-radius: 8px; padding: 4px 20px; margin: 14px 0; } h2 { font-size: 15px; margin: 18px 0 2px; color: var(--vscode-descriptionForeground); }
.row { display: grid; grid-template-columns: 290px 1fr; gap: 18px; align-items: center; padding: 13px 0; border-bottom: 1px solid var(--vscode-editorWidget-border); } .row:last-child { border: 0; } label { font-weight: 600; } .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 4px; }
input, select { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 3px; padding: 7px 9px; font: inherit; } input[type="checkbox"] { width: auto; transform: scale(1.15); } .toggle { display: flex; align-items: center; gap: 10px; }
button { border: 0; border-radius: 3px; padding: 8px 14px; font: inherit; cursor: pointer; color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); } .actions { display: flex; align-items: center; gap: 12px; margin-top: 24px; } #saved { color: var(--vscode-testing-iconPassed); } code { font-family: var(--vscode-editor-font-family); } section.card[hidden], .row[hidden] { display: none; } @media(max-width:900px) { main { padding-left: 28px; }.settings-sidebar { position: static; width: auto; margin: 20px 28px 0; }.settings-sidebar nav { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style></head><body><main>
<h1>自动格式化</h1><p>配置会实时保存到当前工作目录的 <code>.clang-format</code>，并可选择同时启用保存和粘贴时格式化。</p>
<section class="card"><div class="row"><div><label for="enabled">启用自动格式化</label><div class="hint">同时开启保存时格式化和粘贴时格式化。</div></div><label class="toggle"><input id="enabled" type="checkbox"><span>启用</span></label></div></section>
<h2>基础风格</h2><section class="card"><div class="row"><div><label for="basedOnStyle">基础风格（BasedOnStyle）</label><div class="hint">作为其他规则未覆盖部分的基准；下面的选项会覆盖它。</div></div><select id="basedOnStyle"><option value="Google">Google（Google C++ 风格）</option><option value="LLVM">LLVM（LLVM 默认风格）</option><option value="Chromium">Chromium（Chromium 项目风格）</option><option value="Mozilla">Mozilla（Mozilla 项目风格）</option><option value="WebKit">WebKit（WebKit 项目风格）</option></select></div></section>
<h2>行为</h2><section class="card">
<div class="row"><div><label for="allowShortIfStatementsOnASingleLine">单行 if 语句</label><div class="hint">控制短小 if / else 是否可以保持在同一行。</div></div><select id="allowShortIfStatementsOnASingleLine"><option value="Never">Never（始终换行）</option><option value="WithoutElse">WithoutElse（仅无 else 时允许）</option><option value="OnlyFirstIf">OnlyFirstIf（仅 if-else 链的第一个 if）</option><option value="AllIfsAndElse">AllIfsAndElse（if 与 else 都允许）</option></select></div>
<div class="row"><div><label for="allowShortLoopsOnASingleLine">允许单行循环</label><div class="hint">如 <code>for (...) x++;</code> 不强制拆成多行。</div></div><label class="toggle"><input id="allowShortLoopsOnASingleLine" type="checkbox"><span>允许</span></label></div>
<div class="row"><div><label for="allowShortBlocksOnASingleLine">允许单行代码块</label><div class="hint">如 <code>{ return 0; }</code> 不强制拆成多行。</div></div><label class="toggle"><input id="allowShortBlocksOnASingleLine" type="checkbox"><span>允许</span></label></div>
<div class="row"><div><label for="allowShortFunctionsOnASingleLine">单行函数</label><div class="hint">控制短小函数是否保持为一行。</div></div><select id="allowShortFunctionsOnASingleLine"><option value="None">None（所有函数拆行）</option><option value="InlineOnly">InlineOnly（仅 inline 函数）</option><option value="Empty">Empty（仅空函数）</option><option value="Inline">Inline（允许 inline 函数）</option><option value="All">All（所有短函数都允许）</option></select></div>
</section>
<h2>行长与缩进</h2><section class="card">
<div class="row"><div><label for="columnLimit">最大行长（ColumnLimit）</label><div class="hint">超过该长度时 clang-format 会尝试换行；0 表示不限行长。</div></div><input id="columnLimit" type="number" min="0" max="10000" step="1"></div>
<div class="row"><div><label for="indentWidth">缩进宽度（IndentWidth）</label><div class="hint">每一级缩进使用的空格数。</div></div><input id="indentWidth" type="number" min="1" max="32" step="1"></div>
<div class="row"><div><label for="tabWidth">制表符宽度（TabWidth）</label><div class="hint">Tab 显示或等效为多少个空格。</div></div><input id="tabWidth" type="number" min="1" max="32" step="1"></div>
<div class="row"><div><label for="useTab">Tab 使用方式（UseTab）</label><div class="hint">控制缩进时是否实际写入 Tab 字符。</div></div><select id="useTab"><option value="Never">Never（始终使用空格）</option><option value="ForIndentation">ForIndentation（仅基础缩进使用 Tab）</option><option value="ForContinuationAndIndentation">ForContinuationAndIndentation（缩进和续行都使用 Tab）</option><option value="Always">Always（尽可能使用 Tab）</option></select></div>
<div class="row"><div><label for="accessModifierOffset">访问修饰符缩进（AccessModifierOffset）</label><div class="hint">public / private / protected 相对类成员的缩进偏移；负数表示向左。</div></div><input id="accessModifierOffset" type="number" min="-32" max="32" step="1"></div>
</section>
<h2>大括号、指针与代码块</h2><section class="card">
<div class="row"><div><label for="breakBeforeBraces">大括号位置（BreakBeforeBraces）</label><div class="hint">控制函数、类、if 等代码块的左大括号是否另起一行。</div></div><select id="breakBeforeBraces"><option value="Attach">Attach（左大括号不换行）</option><option value="Linux">Linux（函数、命名空间和类定义换行）</option><option value="Mozilla">Mozilla（枚举、函数和类/结构体定义换行）</option><option value="Stroustrup">Stroustrup（函数、else 和 catch 换行）</option><option value="Allman">Allman（所有左大括号换行）</option><option value="Whitesmiths">Whitesmiths（大括号换行并额外缩进）</option><option value="GNU">GNU（GNU 风格）</option><option value="WebKit">WebKit（函数定义左大括号换行）</option><option value="Custom">Custom（使用 BraceWrapping 的细分规则）</option></select></div>
<div class="row"><div><label for="alwaysBreakTemplateDeclarations">模板声明换行（AlwaysBreakTemplateDeclarations）</label><div class="hint">控制 <code>template &lt;...&gt;</code> 与后续声明是否分为两行。</div></div><select id="alwaysBreakTemplateDeclarations"><option value="No">No（尽量不换行）</option><option value="Yes">Yes（始终换行）</option><option value="MultiLine">MultiLine（仅后续声明本身多行时换行）</option></select></div>
<div class="row"><div><label for="pointerAlignment">指针星号位置（PointerAlignment）</label><div class="hint">控制 <code>*</code> 靠近类型、变量名，还是两者之间。</div></div><select id="pointerAlignment"><option value="Left">Left（<code>int* p</code>）</option><option value="Right">Right（<code>int *p</code>）</option><option value="Middle">Middle（<code>int * p</code>）</option></select></div>
<div class="row"><div><label for="spacesBeforeTrailingComments">行尾注释前空格（SpacesBeforeTrailingComments）</label><div class="hint">如 <code>int x;    // 注释</code> 中注释前的空格数。</div></div><input id="spacesBeforeTrailingComments" type="number" min="0" max="100" step="1"></div>
<div class="row"><div><label for="separateDefinitionBlocks">定义块间空行（SeparateDefinitionBlocks）</label><div class="hint">控制相邻函数、类等定义之间是否插入空行。</div></div><select id="separateDefinitionBlocks"><option value="Leave">Leave（保留原有空行）</option><option value="Never">Never（不额外插入空行）</option><option value="Always">Always（相邻定义之间始终插入空行）</option></select></div>
<div class="row"><div><label for="standard">C++ 语言标准（Standard）</label><div class="hint">用于判断可使用的语法和格式化规则。</div></div><select id="standard"><option value="Auto">Auto（自动判断）</option><option value="c++03">c++03</option><option value="c++11">c++11</option><option value="c++14">c++14</option><option value="c++17">c++17</option><option value="c++20">c++20</option><option value="Latest">Latest（使用最新支持标准）</option></select></div>
</section>
<div class="actions"><button id="openFile">打开 .clang-format</button><span id="saved" aria-live="polite"></span></div>
</main><script>
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const workspacePath = ${serializedWorkspacePath};
let saveTimer;
const settingsSidebar = document.createElement('aside'); settingsSidebar.className = 'settings-sidebar'; settingsSidebar.innerHTML = '<strong>自动格式化</strong><input id="settingsSearch" type="search" placeholder="搜索设置"><nav></nav>'; document.body.prepend(settingsSidebar);
const formatCategoryLabels = ['通用', '基础风格', '行为', '行长与缩进', '大括号、指针与代码块']; const formatSections = [...document.querySelectorAll('main > section')].map((section, index) => ({ section, label: formatCategoryLabels[index] || '格式化' }));
const formatHeadings = [...document.querySelectorAll('main > h2')];
let selectedFormatCategory = 'all'; const formatNav = settingsSidebar.querySelector('nav'); const addFormatCategory = (id, label) => { const button = document.createElement('button'); button.textContent = label; button.classList.toggle('active', id === 'all'); button.onclick = () => { selectedFormatCategory = id; formatNav.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button)); filterFormatSettings(); }; formatNav.append(button); }; addFormatCategory('all', '全部'); formatSections.forEach((item, index) => addFormatCategory(String(index), item.label));
function filterFormatSettings() { const query = document.getElementById('settingsSearch').value.trim().toLocaleLowerCase(); formatSections.forEach((item, index) => { const categoryMatches = selectedFormatCategory === 'all' || selectedFormatCategory === String(index); let hasVisibleRow = false; item.section.querySelectorAll('.row').forEach(row => { const visible = categoryMatches && (!query || row.textContent.toLocaleLowerCase().includes(query)); row.hidden = !visible; hasVisibleRow ||= visible; }); item.section.hidden = !hasVisibleRow; if (index > 0) formatHeadings[index - 1].hidden = !hasVisibleRow; }); } document.getElementById('settingsSearch').oninput = filterFormatSettings;
function apply(state) { Object.entries(state).forEach(([key, value]) => { const control = byId(key); if (!control) return; if (control.type === 'checkbox') control.checked = !!value; else control.value = value; }); }
function value() { return { enabled: byId('enabled').checked, basedOnStyle: byId('basedOnStyle').value, allowShortIfStatementsOnASingleLine: byId('allowShortIfStatementsOnASingleLine').value, allowShortLoopsOnASingleLine: byId('allowShortLoopsOnASingleLine').checked, allowShortBlocksOnASingleLine: byId('allowShortBlocksOnASingleLine').checked, allowShortFunctionsOnASingleLine: byId('allowShortFunctionsOnASingleLine').value, columnLimit: Number(byId('columnLimit').value), indentWidth: Number(byId('indentWidth').value), tabWidth: Number(byId('tabWidth').value), useTab: byId('useTab').value, accessModifierOffset: Number(byId('accessModifierOffset').value), breakBeforeBraces: byId('breakBeforeBraces').value, alwaysBreakTemplateDeclarations: byId('alwaysBreakTemplateDeclarations').value, pointerAlignment: byId('pointerAlignment').value, spacesBeforeTrailingComments: Number(byId('spacesBeforeTrailingComments').value), separateDefinitionBlocks: byId('separateDefinitionBlocks').value, standard: byId('standard').value }; }
function save(delay) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { vscode.postMessage({ type: 'save', value: value() }); byId('saved').textContent = '已自动保存'; setTimeout(() => byId('saved').textContent = '', 1200); }, delay); }
document.querySelectorAll('input:not(#settingsSearch), select').forEach(control => { const immediate = control.type === 'checkbox' || control.tagName === 'SELECT'; control.addEventListener('input', () => save(immediate ? 0 : 250)); control.addEventListener('change', () => save(0)); });
byId('openFile').addEventListener('click', () => vscode.postMessage({ type: 'openFile', workspacePath }));
apply(${serializedState});
filterFormatSettings();
</script></body></html>`;
}

function getCppSnippetsHtml(state: SnippetsState): string {
	const serializedState = JSON.stringify(state).replace(/</g, '\\u003c');
	return `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
body { margin: 0; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); } main { display: grid; grid-template-columns: 272px minmax(0, 1fr); min-height: 100vh; }.sidebar { box-sizing: border-box; padding: 24px 16px; background: var(--vscode-sideBar-background); border-right: 1px solid var(--vscode-sideBar-border, var(--vscode-editorWidget-border)); overflow: auto; }.sidebar-title { display: flex; align-items: center; gap: 9px; font-size: 15px; font-weight: 700; margin: 0 0 24px; }.mark { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 7px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font-family: var(--vscode-editor-font-family); }.sidebar label { margin-top: 0; color: var(--vscode-descriptionForeground); font-size: 12px; }.header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 24px 0 8px; }.header strong { font-size: 12px; color: var(--vscode-descriptionForeground); letter-spacing: .03em; }.editor { box-sizing: border-box; padding: 48px clamp(28px, 7vw, 96px); overflow: auto; }.editor-shell { max-width: 820px; }.hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 30px; }.eyebrow { color: var(--vscode-textLink-foreground); font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; } h1 { font-size: 30px; line-height: 1.2; margin: 6px 0 8px; } p { color: var(--vscode-descriptionForeground); margin: 0; line-height: 1.6; }.count { flex: none; color: var(--vscode-descriptionForeground); background: var(--vscode-badge-background); border-radius: 999px; padding: 5px 10px; font-size: 12px; }.form-card { padding: 6px 24px 24px; border: 1px solid var(--vscode-editorWidget-border); border-radius: 12px; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); box-shadow: 0 12px 32px color-mix(in srgb, var(--vscode-editor-background) 70%, transparent); } .snippet { width: 100%; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--vscode-foreground); text-align: left; padding: 10px; cursor: pointer; transition: background .12s ease, border-color .12s ease; }.snippet:hover { background: var(--vscode-list-hoverBackground); }.snippet.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }.snippet small { display: block; color: var(--vscode-descriptionForeground); margin-top: 4px; font-size: 11px; }.snippet.active small { color: inherit; opacity: .76; } label { display: block; font-weight: 600; margin: 20px 0 7px; } input, select, textarea { width: 100%; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); border-radius: 6px; padding: 9px 10px; font: inherit; } input:focus, select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; } textarea { min-height: 220px; resize: vertical; font-family: var(--vscode-editor-font-family); line-height: 1.55; }.two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; } button { border: 0; border-radius: 6px; padding: 8px 11px; font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); cursor: pointer; } button:hover { filter: brightness(1.08); } button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); } button.danger { color: var(--vscode-errorForeground); }.actions { display: flex; gap: 9px; margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--vscode-editorWidget-border); align-items: center; } #saved { margin-left: auto; color: var(--vscode-testing-iconPassed); font-size: 12px; }.empty { color: var(--vscode-descriptionForeground); padding: 40px 4px 20px; text-align: center; } @media (max-width: 720px) { main { grid-template-columns: 1fr; }.sidebar { border-right: 0; border-bottom: 1px solid var(--vscode-editorWidget-border); }.editor { padding: 28px 20px; }.hero { margin-bottom: 22px; }.two { grid-template-columns: 1fr; } }
</style><style>
main { grid-template-columns: 230px minmax(0, 1fr); height: 100vh; min-height: 0; }
.sidebar { padding: 16px; background: var(--vscode-editor-background); border-right: 1px solid var(--vscode-editorWidget-border); }
.sidebar label { color: var(--vscode-foreground); font-size: inherit; }
.editor { padding: 30px; max-width: 760px; }
h1 { font-size: 22px; margin: 0 0 6px; }
.header { margin: 18px 0 0; }.header strong { color: var(--vscode-foreground); font-size: inherit; letter-spacing: normal; }
.snippet { border: 0; border-radius: 3px; padding: 8px; }.snippet.active { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }.snippet.active small { color: var(--vscode-descriptionForeground); opacity: 1; }
label { margin: 14px 0 6px; } input, select, textarea { border-radius: 3px; padding: 7px 9px; } textarea { min-height: 180px; }
.actions { margin-top: 22px; padding-top: 0; border-top: 0; } #saved { margin-left: 0; }
</style></head><body><main>
<aside class="sidebar"><label for="language">编辑语言</label><select id="language"></select><div class="header"><strong>模板列表</strong><button id="add" title="新建模板">＋</button></div><div id="snippetList"></div></aside>
<section class="editor"><h1>代码模板</h1><p>更改会自动保存到当前编辑语言对应的用户片段文件。输入触发前缀后，可在相应语言文件中使用补全展开模板。</p><div id="form"></div><div class="actions"><button id="delete" class="secondary danger">删除模板</button><button id="openJson" class="secondary">打开 JSON</button><span id="saved" aria-live="polite"></span></div></section>
</main><script>
const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
let language = ${serializedState}.language;
const languages = ${serializedState}.languages;
let entries = ${serializedState}.entries;
let selected = entries.length ? 0 : -1;
let saveTimer;
function save() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { vscode.postMessage({ type: 'save', language, entries }); byId('saved').textContent = '已自动保存'; setTimeout(() => byId('saved').textContent = '', 1200); }, 250); }
function renderLanguages() { const select = byId('language'); select.replaceChildren(); languages.forEach(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; select.append(option); }); select.value = language; }
function select(index) { selected = index; render(); }
function renderList() { const list = byId('snippetList'); list.replaceChildren(); entries.forEach((entry, index) => { const button = document.createElement('button'); button.className = 'snippet' + (index === selected ? ' active' : ''); button.textContent = entry.name || '未命名模板'; const prefix = document.createElement('small'); prefix.textContent = entry.prefix ? '触发：' + entry.prefix : '尚未设置触发前缀'; button.append(prefix); button.onclick = () => select(index); list.append(button); }); }
function field(label, key, multiline) { const wrapper = document.createElement('div'); const title = document.createElement('label'); title.textContent = label; const control = document.createElement(multiline ? 'textarea' : 'input'); control.value = entries[selected][key] || ''; control.oninput = () => { entries[selected][key] = control.value; if (key === 'name' || key === 'prefix') renderList(); save(); }; wrapper.append(title, control); return wrapper; }
function renderForm() { const form = byId('form'); form.replaceChildren(); if (selected < 0) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = '还没有模板。点击左侧 ＋ 新建一个。'; form.append(empty); return; } form.append(field('模板名称', 'name'), field('触发前缀', 'prefix'), field('模板内容', 'body', true), field('说明（可选）', 'description')); const patterns = document.createElement('div'); patterns.className = 'two'; patterns.append(field('Include（逗号分隔，可选）', 'include'), field('Exclude（逗号分隔，可选）', 'exclude')); form.append(patterns); }
function render() { renderList(); renderForm(); byId('delete').disabled = selected < 0; }
byId('add').onclick = () => { entries.push({ name: '新模板', prefix: '', body: '', description: '', include: '', exclude: '' }); selected = entries.length - 1; render(); save(); };
function deleteSelected() { if (selected < 0) return; entries.splice(selected, 1); selected = Math.min(selected, entries.length - 1); render(); save(); }
byId('delete').onclick = () => { if (selected < 0) return; vscode.postMessage({ type: 'confirmDelete', language, name: entries[selected].name || '未命名模板' }); };
byId('openJson').onclick = () => vscode.postMessage({ type: 'openJson', language });
byId('language').onchange = () => { clearTimeout(saveTimer); vscode.postMessage({ type: 'selectLanguage', language: byId('language').value }); };
window.addEventListener('message', event => { if (event.data?.type === 'deleteConfirmed' && event.data.language === language) deleteSelected(); else if (event.data?.type === 'state') { language = event.data.value.language; entries = event.data.value.entries; selected = entries.length ? 0 : -1; renderLanguages(); render(); } });
renderLanguages(); render();
</script></body></html>`;
}
