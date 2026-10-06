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

test('covers the rendered English setup surfaces', () => {
	const extensionRoot = path.resolve(__dirname, '../..');
	const localization = fs.readFileSync(path.join(extensionRoot, 'src', 'localization.ts'), 'utf8');

	for (const text of [
		'当前已是最新版本。',
		'浏览器分栏比例（10–90）',
		'可为每个 OJ 设置题面来源。',
		'初始配置',
		'检查编译环境并配置编辑器、模版和代码存放目录。',
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
		'如果 ShortestPath IDE 对你有帮助，欢迎支持项目持续维护与更新。',
		'打开支持页面',
		'关闭 7 天',
		'7 天内不再显示',
		'无法打开支持页面：{0}',
	]) {
		assert.match(localization, new RegExp(`['"]${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*:`));
	}
	assert.match(localization, /当前字体/);
	assert.match(localization, /编辑器默认/);
	assert.match(localization, /value!==node\.nodeValue/);
	assert.match(localization, /value!==node\.getAttribute\(attribute\)/);

	for (const [file, pattern] of [
		['simpleSettings.ts', /localizeFormat\('确定删除模板/],
		['extension.ts', /showInformationMessage\(localize\('ShortestPath IDE 已配置为使用便携工具链/],
	] as const) {
		assert.match(fs.readFileSync(path.join(extensionRoot, 'src', file), 'utf8'), pattern);
	}
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
	assert.match(gettingStarted, /type: 'startEnvironment'/);
	assert.match(gettingStarted, /type: 'complete'/);
	assert.match(gettingStarted, /environmentRunner\?\.snapshot.ready/);
	assert.match(gettingStarted, /completed \? findCppStandard\(compilerFlags\) : 'c\+\+20'/);
	assert.doesNotMatch(gettingStarted, /pickWorkspaceFolder|configureLocale|type: 'skip'/);
	assert.match(gettingStarted, /globalState\.update\(GETTING_STARTED_VERSION/);
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


test('all native and first-run Chinese localization keys have English translations', () => {
	const root = path.resolve(__dirname, '../..', 'src');
	const code = fs.readFileSync(path.join(root, 'localization.ts'), 'utf8');
	const exports: { dictionary?: Record<string, string> } = {};
	vm.runInNewContext(ts.transpileModule(code + '\nexport const dictionary = english;', {
		compilerOptions: { module: ts.ModuleKind.CommonJS }
	}).outputText, { exports, require: () => ({ env: { language: 'en' } }) });
	const missing = new Set<string>();
	for (const file of fs.readdirSync(root).filter(file => file.endsWith('.ts'))) {
		const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
		function visit(node: ts.Node): void {
			if (ts.isCallExpression(node) && ['localize', 'localizeFormat'].includes(node.expression.getText(source)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
				const value = node.arguments[0].text;
				if (/[\u4e00-\u9fff]/.test(value) && !exports.dictionary?.[value]) {
					missing.add(value);
				}
			}
			ts.forEachChild(node, visit);
		}
		visit(source);
	}
	assert.deepEqual([...missing], []);
	const firstRun = fs.readFileSync(path.join(root, 'gettingStarted.ts'), 'utf8');
	assert.match(firstRun, /title: localize\('编译配置'\)/);
	assert.doesNotMatch(firstRun, /class="badge">(?:Toolchain|Configuration|Workspace)</);
});
