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
		'Competitive Programming Helper（CPH）',
		'clangd 扩展',
		'未发现可用的系统等宽字体，无法选择主要字体。',
		'✓ 已自动保存 · 切换窗口时',
		'CPH 默认命名',
		'CPH 文件名模板覆盖必须是一个 JSON 对象，OJ 简称为键、模板字符串为值。',
		'无法读取 {0}.json。请检查 JSON 格式。',
		'Open VSX 是独立的第三方插件市场。其内容不由 ShortestPath IDE 审核、担保或提供支持；安装第三方扩展可能执行代码并访问你的工作区数据。',
		'未能读取系统字体。请检查系统字体服务后重新打开此页面。',
		'模板名称',
		'尚未设置触发前缀',
		'这个放松源已经添加过了。',
	]) {
		assert.match(localization, new RegExp(`['"]${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]\\s*:`));
	}
	assert.match(localization, /当前字体/);
	assert.match(localization, /编辑器默认/);
	assert.match(localization, /value!==node\.nodeValue/);
	assert.match(localization, /value!==node\.getAttribute\(attribute\)/);

	for (const [file, pattern] of [
		['gettingStarted.ts', /showWarningMessage\(localize\('CPH 文件名模板覆盖/],
		['relaxMode.ts', /showErrorMessage\(localizeFormat\('无法打开放松源/],
		['simpleSettings.ts', /localizeFormat\('确定删除模板/],
		['extension.ts', /showInformationMessage\(localize\('ShortestPath IDE 已配置为使用便携工具链/],
	] as const) {
		assert.match(fs.readFileSync(path.join(extensionRoot, 'src', file), 'utf8'), pattern);
	}
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
	assert.match(extension, /'toolchains', 'winlibs', 'mingw64-ucrt-15', 'share', 'locale'/);
	assert.doesNotMatch(extension, /ProgressLocation\.Notification/);
	assert.doesNotMatch(extension, /便携工具链由首次启动设置窗口下载/);
	assert.doesNotMatch(extension, /下载将在设置终端中继续/);
});
