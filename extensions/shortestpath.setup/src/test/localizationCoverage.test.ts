/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { test } from 'node:test';

test('covers the rendered English setup surfaces', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const localization = fs.readFileSync(path.join(extensionRoot, 'src', 'localization.ts'), 'utf8');

	for (const text of [
		'当前已是最新版本。',
		'浏览器分栏比例（10–90）',
		'可为每个 OJ 设置题面来源。',
		'用几步配置好你的竞赛编程环境偏好。所有改动都会实时生效，随时可以返回调整。',
		'准备编译环境',
		'先检测并配置 g++ 与 clangd，环境准备完成后再继续设置 IDE 偏好。',
		'正在准备编译环境',
		'编译环境准备失败：{0}',
		'基础风格（BasedOnStyle）',
		'控制短小 if / else 是否可以保持在同一行。',
		'行长与缩进',
		'大括号、指针与代码块',
		'ShortestPath Judger',
		'clangd 扩展',
		'未发现可用的系统等宽字体，无法选择主要字体。',
		'✓ 已自动保存 · 切换窗口时',
		'Judger 默认命名',
		'Judger 文件名模板覆盖必须是一个 JSON 对象，OJ 简称为键、模板字符串为值。',
		'无法读取 {0}.json。请检查 JSON 格式。',
		'Open VSX 是独立的第三方插件市场。其内容不由 ShortestPath IDE 审核、担保或提供支持；安装第三方扩展可能执行代码并访问你的工作区数据。',
		'未能读取系统字体。请检查系统字体服务后重新打开此页面。',
		'模板名称',
		'尚未设置触发前缀',
		'这个放松源已经添加过了。',
		'请我喝杯咖啡',
		'如果 ShortestPath IDE 对你有帮助，欢迎支持项目持续维护与更新。',
		'打开支持页面',
		'关闭 7 天',
		'7 天内不再显示',
		'无法打开支持页面：{0}',
		'缩进',
		'Error Lens 行内错误提示',
		'首页',
		'扩展',
	]) {
		assert.match(localization, new RegExp(`['"]${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*:`));
	}
	assert.match(localization, /当前字体/);
	assert.match(localization, /编辑器默认/);
	assert.match(localization, /value!==node\.nodeValue/);
	assert.match(localization, /value!==node\.getAttribute\(attribute\)/);

	for (const [file, pattern] of [
		['gettingStarted.ts', /showWarningMessage\(localize\('Judger 文件名模板覆盖/],
		['relaxMode.ts', /showErrorMessage\(localizeFormat\('无法打开放松源/],
		['simpleSettings.ts', /localizeFormat\('确定删除模板/],
		['extension.ts', /showInformationMessage\(localize\('ShortestPath IDE 已配置为使用便携工具链/],
	] as const) {
		assert.match(fs.readFileSync(path.join(extensionRoot, 'src', file), 'utf8'), pattern);
	}
});

test('keeps indentation and Error Lens wiring in the simplified settings', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const settings = fs.readFileSync(path.join(extensionRoot, 'src', 'simpleSettings.ts'), 'utf8');
	// Indentation drives both the editor and the workspace clang-format file, so
	// the formatter cannot silently fall back to the 2-space LLVM default. The call
	// site is the part worth pinning: asserting the helper body on its own still
	// passes when the helper is never reached.
	assert.match(settings, /settings\.update\('editor\.tabSize', indentSize/);
	assert.match(settings, /settings\.update\('editor\.insertSpaces', insertSpaces/);
	assert.match(settings, /await syncClangFormatIndentation\(indentSize, insertSpaces\);/);
	// Gating the sync on the editor configuration left real divergences in place:
	// the file can disagree with the editor while the editor already matches the form.
	assert.doesNotMatch(settings, /indentationChanged/);
	// The page exposes the inline-diagnostics switch instead of the code lens one.
	assert.match(settings, /id="errorLensEnabled"/);
	assert.match(settings, /id="indentSize"/);
	assert.match(settings, /id="indentStyle"/);
	assert.doesNotMatch(settings, /errorLens\.codeLensEnabled/);
	assert.match(settings, /settings\.update\('errorLens\.enabled'/);
});

test('edits only the indentation keys of an existing .clang-format', () => {
	// Behavioural rather than textual: the defect this guards is "the whole file is
	// rewritten", which no source pattern can distinguish from a safe edit. This
	// runs the compiled helper, so it exercises the code that actually ships.
	const compiled = fs.readFileSync(path.join(__dirname, '..', 'simpleSettings.js'), 'utf8');
	const source = /function applyClangFormatIndentation\(content, indentSize, useTab\) \{[\s\S]*?\n\}/.exec(compiled)?.[0];
	assert.ok(source, 'applyClangFormatIndentation is missing from the compiled output');
	const apply = vm.runInNewContext(`${source}\napplyClangFormatIndentation`) as (content: string, indentSize: number, useTab: string) => string | undefined;

	// YAML keeps its comments, its foreign options, and their original order; the
	// missing keys are appended rather than the file being regenerated.
	const yaml = 'BasedOnStyle: LLVM\n# keep me\nIndentWidth: 2\nSortIncludes: false\nIncludeBlocks: Preserve\n';
	assert.strictEqual(
		apply(yaml, 4, 'Never'),
		'BasedOnStyle: LLVM\n# keep me\nIndentWidth: 4\nSortIncludes: false\nIncludeBlocks: Preserve\nTabWidth: 4\nUseTab: Never\n'
	);

	// clang-format also accepts JSON, which must stay JSON.
	const json = apply('{\n  "IndentWidth": 2,\n  "SortIncludes": false\n}\n', 4, 'ForIndentation');
	assert.ok(json);
	assert.deepStrictEqual(JSON.parse(json), { IndentWidth: 4, SortIncludes: false, TabWidth: 4, UseTab: 'ForIndentation' });

	// A file that cannot be parsed safely is left alone instead of being corrupted.
	assert.strictEqual(apply('{ "IndentWidth": ', 4, 'Never'), undefined);
});

test('writes both workspace config files during first-run setup', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const extension = fs.readFileSync(path.join(extensionRoot, 'src', 'extension.ts'), 'utf8');
	// The first-run branch must create .clang-format next to .clangd. Without it
	// clang-format falls back to the LLVM style and reformats to 2 spaces.
	assert.match(extension, /createDefaultClangdProjectConfig\(firstRunSelection\.workspaceFolder[\s\S]{0,160}createDefaultClangFormatConfig\(firstRunSelection\.workspaceFolder\)/);
	// The prompt is keyed on .clang-format alone: a foreign C++ project carries one
	// without a .clangd and must not be asked, while a fresh folder and a workspace
	// left behind by the old first run both lack it and must be asked. The body is
	// pinned exactly, so re-adding a .clangd requirement fails this test.
	assert.match(extension, /function hasOiWorkspaceConfig\(workspaceFolder: vscode\.WorkspaceFolder\): boolean \{\s*return fs\.existsSync\(path\.join\(workspaceFolder\.uri\.fsPath, '\.clang-format'\)\);\s*\}/);
});

test('backfills .clang-format for installs upgraded from the broken first run', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const extension = fs.readFileSync(path.join(extensionRoot, 'src', 'extension.ts'), 'utf8');
	assert.match(extension, /const CLANG_FORMAT_MIGRATION = 'shortestpath\.clangFormat\.v1';/);
	assert.match(extension, /async function repairLegacyClangFormatConfig\(\): Promise<boolean>/);
	assert.match(extension, /createDefaultClangFormatConfig\(folder\)/);
	// Only a workspace ShortestPath already set up is repaired, so a foreign C++
	// project never gets a .clang-format written into it.
	assert.match(extension, /if \(!fs\.existsSync\(path\.join\(folder, '\.clangd'\)\) \|\| fs\.existsSync\(path\.join\(folder, '\.clang-format'\)\)\)/);
	// Per workspace, not global: a global flag repaired only the first workspace
	// ever opened and left every other one broken.
	assert.match(extension, /if \(!context\.workspaceState\.get<boolean>\(CLANG_FORMAT_MIGRATION\)\)/);
	assert.doesNotMatch(extension, /globalState\.(get|update)<boolean>\(CLANG_FORMAT_MIGRATION\)/);
	// The flag is set only after the repair actually ran; a launch without an open
	// folder must leave it pending instead of consuming it.
	assert.match(extension, /if \(await repairLegacyClangFormatConfig\(\)\) \{\s*await context\.workspaceState\.update\(CLANG_FORMAT_MIGRATION, true\);/);
	// An unwritable folder must not take the whole extension down with it.
	assert.match(extension, /try \{\s*if \(await repairLegacyClangFormatConfig\(\)\) \{/);
});

test('describes the OI workspace completion prompt without over-claiming', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const extension = fs.readFileSync(path.join(extensionRoot, 'src', 'extension.ts'), 'utf8');
	const localization = fs.readFileSync(path.join(extensionRoot, 'src', 'localization.ts'), 'utf8');
	// hasOiWorkspaceConfig fires when either file is missing, so the wording has
	// to hold for a partially configured workspace as well.
	assert.match(extension, /OI 项目配置不完整。要补全/);
	assert.match(extension, /OI 项目配置已补全。/);
	// No orphaned English entries for the old "create both from scratch" wording.
	assert.doesNotMatch(localization, /尚未包含 OI 项目配置/);
	assert.doesNotMatch(localization, /已在“\{0\}”中创建/);
	assert.match(localization, /'“\{0\}”的 OI 项目配置不完整。要补全 \.clangd 和 \.clang-format 吗？'/);
});

test('keeps a single source for the default .clang-format and compiler flags', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const extension = fs.readFileSync(path.join(extensionRoot, 'src', 'extension.ts'), 'utf8');
	const settings = fs.readFileSync(path.join(extensionRoot, 'src', 'simpleSettings.ts'), 'utf8');
	// extension.ts must consume the settings-page model rather than keeping its
	// own copy; a second copy is exactly how the two paths drift apart.
	assert.doesNotMatch(extension, /BasedOnStyle: Google/);
	assert.doesNotMatch(extension, /D_GLIBCXX_DEBUG/);
	assert.match(extension, /defaultClangFormatConfig\(\)/);
	assert.match(extension, /defaultCompilerFlagsFor\(cppStandard\)/);
	// simpleSettings owns both defaults and exports them.
	assert.match(settings, /export function defaultClangFormatConfig\(\): string \{/);
	assert.match(settings, /return serializeAutoFormat\(defaultAutoFormatState\);/);
	assert.match(settings, /export function defaultCompilerFlagsFor\(cppStandard: CppStandard\): string \{/);
	assert.match(settings, /export const defaultCompilerFlags = defaultCompilerFlagsFor\('c\+\+23'\);/);
});

test('ships auto formatting disabled in the recommended settings', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const recommended = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'resources', 'recommended-settings.json'), 'utf8')) as Record<string, unknown>;
	assert.strictEqual(recommended['editor.formatOnSave'], false);
	assert.strictEqual(recommended['editor.formatOnPaste'], false);
	// The main process and the setup extension both read this one file, so it is the
	// only place the default may live. The settings page has to keep deriving its
	// toggle from the live configuration instead of hardcoding a default of its own.
	const settings = fs.readFileSync(path.join(extensionRoot, 'src', 'simpleSettings.ts'), 'utf8');
	assert.match(settings, /autoFormat: editor\.get<boolean>\('formatOnSave'\) === true && editor\.get<boolean>\('formatOnPaste'\) === true,/);
});

test('keeps the Buy Me a Coffee entry dismissible for seven days', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const settings = fs.readFileSync(path.join(extensionRoot, 'src', 'simpleSettings.ts'), 'utf8');
	assert.match(settings, /const buyMeACoffeeHideDuration = 7 \* 24 \* 60 \* 60 \* 1000;/);
	assert.match(settings, /openBrowserTab\(buyMeACoffeeUrl/);
	assert.match(settings, /get<unknown>\(buyMeACoffeeDismissedUntilKey\)/);
	assert.match(settings, /isBuyMeACoffeeVisible\(context\)/);
	assert.match(settings, /message\?\.type === 'buyMeACoffee'/);
	assert.match(settings, /message\?\.type === 'dismissBuyMeACoffee'/);
	assert.match(settings, /update\(buyMeACoffeeDismissedUntilKey, Date\.now\(\) \+ buyMeACoffeeHideDuration\)/);
	// The entry only reaches the page while it is inside its visible window.
	assert.match(settings, /const buyMeACoffeeHtml = showBuyMeACoffee[\s\S]{0,40}\?/);
});

test('compiles the setup bootstrap and translates input attributes without rewrite loops', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const localization = fs.readFileSync(path.join(extensionRoot, 'src', 'localization.ts'), 'utf8');
	const literal = localization.match(/const script = (`[\s\S]*?`);/)?.[1];
	assert.ok(literal);
	const script = new Function('strings', `return ${literal};`)(JSON.stringify({ '搜索设置': 'Search settings' })) as string;
	const body = script.replace(/^<script[^>]*>|<\/script>$/g, '');
	assert.doesNotThrow(() => new Function(body));
	let writes = 0;
	class FakeElement {
		nodeType = 1;
		parentElement: FakeElement | null = null;
		tagName: string;
		childNodes: FakeElement[] = [];
		private attributes: Map<string, string>;
		constructor(tagName: string) { this.tagName = tagName; this.attributes = tagName === 'INPUT' ? new Map([['placeholder', '搜索设置']]) : new Map(); }
		hasAttribute(name: string): boolean { return this.attributes.has(name); }
		getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
		setAttribute(name: string, value: string): void { writes++; this.attributes.set(name, value); }
		closest(): null { return null; }
	}
	const bodyElement = new FakeElement('BODY');
	const input = new FakeElement('INPUT'); input.parentElement = bodyElement; bodyElement.childNodes = [input];
	let observerCallback: ((records: Array<{ type: string; target: FakeElement }>) => void) | undefined;
	const document = { documentElement: { lang: '' }, body: bodyElement };
	class FakeObserver { constructor(callback: typeof observerCallback) { observerCallback = callback; } observe(): void {} }
	vm.runInNewContext(body, { document, Node: { TEXT_NODE: 3 }, HTMLElement: FakeElement, MutationObserver: FakeObserver });
	assert.equal(input.getAttribute('placeholder'), 'Search settings');
	assert.equal(writes, 1);
	observerCallback?.([{ type: 'attributes', target: input }]);
	assert.equal(writes, 1);
});

test('localizes first-run progress messages while preserving installer output', () => {
	const firstRun = fs.readFileSync(path.resolve(__dirname, '../../../..', 'resources/oi-defaults/first-run.html'), 'utf8');
	assert.match(firstRun, /const localizeProgress = message => language === 'en' \? message : message/);
	assert.match(firstRun, /progressDescription\.textContent = message/);
	assert.match(firstRun, /progress\.setAttribute\('aria-valuetext', message\)/);
	for (const text of ['正在准备 $1…', '正在下载 $1… $2', '正在解压 $1… $2', '便携工具链安装完成。', '下载连接超时。']) {
		assert.match(firstRun, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
	}
});

test('keeps first-run preparation in the editor-tab setup flow', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const gettingStarted = fs.readFileSync(path.join(extensionRoot, 'src', 'gettingStarted.ts'), 'utf8');
	const extension = fs.readFileSync(path.join(extensionRoot, 'src', 'extension.ts'), 'utf8');
	const windowsPreset = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'resources', 'windows.json'), 'utf8')) as { downloadSources?: unknown };
	const windowsInstaller = fs.readFileSync(path.join(extensionRoot, 'resources', 'windows.js'), 'utf8');
	const workspaceCommands = fs.readFileSync(path.resolve(__dirname, '../../../..', 'src/vs/workbench/browser/actions/workspaceCommands.ts'), 'utf8');
	assert.match(gettingStarted, /function getFirstRunHtml/);
	assert.match(gettingStarted, /type: 'installToolchain'/);
	assert.match(gettingStarted, /type: 'pickWorkspaceFolder'/);
	assert.match(gettingStarted, /type: 'complete'/);
	assert.match(gettingStarted, /class="workspace-picker"/);
	assert.match(gettingStarted, /workspace-picker button \{ flex: 0 0 auto; white-space: nowrap; \}/);
	assert.match(gettingStarted, /setWorkspaceFolderTrust[\s\S]*vscode\.openFolder/);
	assert.match(gettingStarted, /globalState\.update\(GETTING_STARTED_VERSION/);
	assert.match(gettingStarted, /forceReuseWindow: true/);
	assert.doesNotMatch(gettingStarted, /workbench\.action\.reloadWindow/);
	assert.match(workspaceCommands, /setWorkspaceFolderTrust/);
	assert.match(workspaceCommands, /setUrisTrust\(\[uri\], true\)/);
	assert.match(extension, /installPortableAssets/);
	assert.match(extension, /shortestpath\.installToolchainStage/);
	assert.match(extension, /shortestpath\.applyFirstRunSetup/);
	assert.match(extension, /await removeLegacyWindowsCompilerLocale\(context\)/);
	assert.match(extension, /getToolchainRoot\(context\), 'winlibs', 'mingw64-ucrt-15', 'share', 'locale'/);
	assert.equal(windowsPreset.downloadSources, undefined);
	assert.match(windowsInstaller, /bundledArchivePath: 'resources\/oi-defaults\/toolchains\/clangd-windows-/);
	assert.match(windowsInstaller, /bundledArchivePath: `resources\/oi-defaults\/toolchains\/\$\{mingwArchiveName\}`/);
	assert.doesNotMatch(extension, /ProgressLocation\.Notification/);
	assert.doesNotMatch(extension, /便携工具链由首次启动设置窗口下载/);
	assert.doesNotMatch(extension, /下载将在设置终端中继续/);
});
