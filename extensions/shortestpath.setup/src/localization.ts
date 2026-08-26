/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const english: Readonly<Record<string, string>> = {
	'开始使用': 'Get Started',
	'代码模板': 'Code Snippets',
	'自动格式化': 'Automatic Formatting',
	'CPH 设置': 'CPH Settings',
	'工具链诊断': 'Toolchain Diagnostics',
	'放松模式设置': 'Relax Mode Settings',
	'放松模式': 'Relax Mode',
	'在线评测映射': 'Online Judge Mappings',
	'VJudge 映射': 'VJudge Mappings',
	'保存': 'Save',
	'删除': 'Remove',
	'新增映射': 'Add Mapping',
	'删除此映射': 'Remove Mapping',
	'已保存': 'Saved',
	'打开目录': 'Open Folder',
	'重新检测': 'Refresh',
	'重新探测编译器': 'Re-detect Compiler',
	'修复工具链': 'Repair Toolchain',
	'启用': 'Enable',
	'不指定': 'Ask Every Time',
	'运行': 'Run',
	'题目与文件': 'Problems and Files',
	'文件名': 'File Names',
	'映射': 'Mappings',
	'添加 OJ 规则': 'Add OJ Rule',
	'配置在线评测映射': 'Configure Online Judge Mappings',
	'配置 VJudge 映射': 'Configure VJudge Mappings',
	'打开详细设置': 'Open Detailed Settings',
	'上一步': 'Back',
	'下一步': 'Next',
	'开始': 'Start',
	'完成': 'Finish',
	'显示': 'Show',
	'隐藏': 'Hide',
	'关闭': 'Off',
	'默认': 'Default',
	'自定义': 'Custom',
	'基础风格': 'Base Style',
	'单行 if 语句': 'Single-line if Statements',
	'单行函数': 'Single-line Functions',
	'大括号位置': 'Brace Position',
	'模板声明换行': 'Template Declaration Wrapping',
	'指针星号位置': 'Pointer Alignment',
	'定义块间空行': 'Blank Lines Between Definitions',
	'C++ 语言标准': 'C++ Language Standard',
	'字体': 'Fonts',
	'主题': 'Theme',
	'编译': 'Compilation',
	'智能提示': 'IntelliSense',
	'文件': 'Files',
	'格式化': 'Formatting',
	'模板': 'Templates',
	'放松设置': 'Relax Settings',
	'隐藏模式': 'Hide Mode',
	'恢复默认源': 'Restore Default Sources',
	'添加新的放松源': 'Add a Relax Source',
	'名称（可选）': 'Name (optional)',
	'网站地址': 'Website URL',
	'加入放松源': 'Add Source',
	'打开': 'Open',
	'移除': 'Remove',
	'内置放松源': 'Built-in source',
	'自定义放松源': 'Custom source',
	'尚未启动': 'Not started',
	'已启动': 'Started',
	'放松模式已启动': 'Relax mode is active',
	'放松模式尚未启动': 'Relax mode is not active',
	'自定义快捷键': 'Customize Shortcut',
	'启动/显示放松模式': 'Start / Show Relax Mode',
	'隐藏放松模式': 'Hide Relax Mode'
	,'设置': 'Settings'
	,'搜索设置': 'Search Settings'
	,'全部': 'All'
	,'编辑器': 'Editor'
	,'C++ 与 clangd': 'C++ and clangd'
	,'外观与保存': 'Appearance and Save'
	,'工具': 'Tools'
	,'只保留竞赛编程常用选项。更改会自动保存；其他设置可在高级设置中调整。': 'Only commonly used competitive-programming options are shown here. Changes save automatically; adjust other settings in Advanced Settings.'
	,'仅可从检测到的系统等宽字体中选择，不支持手动输入。': 'Choose only from detected system monospaced fonts; manual input is not supported.'
	,'正在读取系统字体…': 'Reading system fonts…'
	,'正在读取系统字体，请稍候。': 'Reading system fonts. Please wait.'
	,'回退字体': 'Fallback Fonts'
	,'字形缺失时按顺序回退；可选择非等宽中文或 Emoji 字体。': 'Fonts fall back in order for missing glyphs. Non-monospaced CJK and Emoji fonts are allowed.'
	,'添加回退字体': 'Add Fallback Font'
	,'启用字体连字': 'Enable Font Ligatures'
	,'字体大小': 'Font Size'
	,'新建文件默认语言': 'Default Language for New Files'
	,'从 New Tab 新建文件时默认使用的语言。': 'The default language when creating a file from New Tab.'
	,'启用自动格式化': 'Enable Automatic Formatting'
	,'同时控制保存时格式化和粘贴时格式化。': 'Controls formatting on both save and paste.'
	,'自动格式化规则': 'Automatic Formatting Rules'
	,'配置当前工作目录的 .clang-format。': 'Configure .clang-format in the current workspace folder.'
	,'配置格式化规则': 'Configure Formatting Rules'
	,'C++ 版本': 'C++ Version'
	,'ShortestPath OJ 提交语言': 'ShortestPath OJ Submission Language'
	,'“每次询问”会在 C++ 提交前选择 C++14 或 C++20。': '“Ask Every Time” lets you choose C++14 or C++20 before each C++ submission.'
	,'每次询问': 'Ask Every Time'
	,'编译选项': 'Compiler Options'
	,'同时应用到 CPH 和 C/C++ Compile Run。': 'Applied to both CPH and C/C++ Compile Run.'
	,'clangd 变量类型提示': 'clangd Variable Type Hints'
	,'在 auto 等推断变量后显示类型；此开关使用 VS Code 的内嵌提示设置。': 'Show inferred types after variables such as auto; this uses VS Code’s inlay-hint setting.'
	,'自动清理生成文件': 'Automatically Clean Generated Files'
	,'同时作用于 CPH 和 C/C++ Compile Run。': 'Applies to both CPH and C/C++ Compile Run.'
	,'生成文件保留时间': 'Generated File Retention'
	,'程序运行结束后自动删除 exe。单位：秒；0 表示立即删除。': 'Automatically delete executables after a program finishes. Unit: seconds; 0 deletes immediately.'
	,'同步系统主题': 'Follow System Theme'
	,'现代界面': 'Modern UI'
	,'启用 Workbench › Experimental: Modern UI，使用浮动面板和更新后的工作台样式。': 'Enable Workbench › Experimental: Modern UI for floating panels and an updated workbench style.'
	,'延迟后自动保存': 'Auto Save after Delay'
	,'自动保存': 'Auto Save'
	,'已自动保存': 'Saved automatically'
	,'自动保存：': 'Auto Save: '
	,'切换焦点时保存': 'Save on Focus Change'
	,'切换窗口时保存': 'Save on Window Change'
	,'使用插件市场': 'Use Extension Marketplace'
	,'开启后显示扩展入口，并使用 Open VSX 插件市场。': 'Show the Extensions entry and use the Open VSX extension marketplace.'
	,'分步引导配置字体、主题、语言版本等偏好。': 'Configure fonts, themes, language versions, and other preferences step by step.'
	,'打开引导': 'Open Guide'
	,'配置 C++ 用户代码片段。': 'Configure C++ user code snippets.'
	,'配置代码模板': 'Configure Code Snippets'
	,'配置题目下载、Judge、VJudge 与 CPH 编译运行行为。': 'Configure problem downloading, Judge, VJudge, and CPH compile-and-run behavior.'
	,'配置 CPH': 'Configure CPH'
	,'ShortestPath IDE 更新': 'ShortestPath IDE Updates'
	,'立即检查新版本，并在可用时打开下载页面。': 'Check for a new version now and open the download page when one is available.'
	,'检查更新': 'Check for Updates'
	,'在诊断位置上方显示 Error Lens 的代码透镜。': 'Show the Error Lens code lens above diagnostic locations.'
	,'检查 CPH、Compile Run、clangd 与编译器是否可用且配置一致。': 'Check whether CPH, Compile Run, clangd, and the compiler are available and configured consistently.'
	,'打开诊断页': 'Open Diagnostics'
	,'防诈骗提醒': 'Anti-fraud Reminder'
	,'打开题目时显示防诈骗提醒。': 'Show an anti-fraud reminder when opening a problem.'
	,'没有匹配的设置。': 'No matching settings.'
	,'高级设置': 'Advanced Settings'
	,'请先打开一个本地文件夹，再初始化 OI 项目配置。': 'Open a local folder before initializing OI project configuration.'
	,'已在“{0}”中创建 .clangd 和 .clang-format。': 'Created .clangd and .clang-format in “{0}”.'
	,'“{0}”尚未包含 OI 项目配置。要创建 .clangd 和 .clang-format 吗？': '“{0}” does not contain OI project configuration. Create .clangd and .clang-format?'
	,'初始化 OI 配置': 'Initialize OI Configuration'
	,'暂不初始化': 'Not Now'
	,'ShortestPath 所处运行路径包含空格，可能出现意外错误，开发者不会处理因包含空格而导致的 bug。': 'The ShortestPath runtime path contains spaces, which may cause unexpected errors. Bugs caused by spaces in the path will not be handled.'
	,'ShortestPath IDE will show the first-run setup after restart.': 'ShortestPath IDE will show the first-run setup after restart.'
	,'Restart Now': 'Restart Now'
	,'正在进入工具链修复。请在开箱页继续，ShortestPath IDE 会重新下载缺失的组件。': 'Starting toolchain repair. Continue in the setup window; ShortestPath IDE will download missing components again.'
	,'未检测到 Homebrew GCC，当前将使用 Apple Clang（g++ 兼容包装器）。它可以编译代码，但为保持竞赛环境一致，建议执行“修复工具链”安装 Homebrew GCC。': 'Homebrew GCC was not found, so Apple Clang (a g++ compatibility wrapper) will be used. It can compile code, but installing Homebrew GCC with “Repair Toolchain” is recommended for a consistent competitive-programming environment.'
	,'继续使用 Apple Clang': 'Continue with Apple Clang'
	,'未检测到 {0}。{1}。安装命令会在集成终端中运行，可能需要管理员权限。': '{0} was not found. {1}. The install command will run in the integrated terminal and may require administrator privileges.'
	,'和': 'and'
	,'安装并修复': 'Install and Repair'
	,'暂不处理': 'Not Now'
	,'“{0}”不能为空。': '“{0}” is required.'
	,'“{0}”重复。': '“{0}” is duplicated.'
	,'域名（键）': 'Host (key)'
	,'OJ 代号': 'OJ abbreviation'
	,'OJ 名称': 'OJ name'
	,'比赛 ID 正则': 'Contest ID regular expression'
	,'题目 ID 正则': 'Problem ID regular expression'
	,'VJudge OJ 名称（键）': 'VJudge OJ name (key)'
	,'原题 URL 模板': 'Original problem URL template'
	,'可用 {contestId}、{problemId}': 'Available: {contestId}, {problemId}'
	,'题号正则': 'Problem ID regular expression'
	,'组合题号格式': 'Composite problem ID format'
	,'VJudge URL 名称覆盖': 'VJudge URL name override'
	,'显示语言': 'Display Language'
	,'选择 ShortestPath IDE 的显示语言。': 'Choose the display language for ShortestPath IDE.'
	,'当前：': 'Current: '
	,'中文（简体）': 'Chinese (Simplified)'
	,'。选择后将按 VS Code 的正常流程确认并重启。': '. After selection, VS Code will confirm the change and restart normally.'
	,'选择后将按 VS Code 的正常流程确认并重启。': 'After selection, VS Code will confirm the change and restart normally.'
	,'切换显示语言': 'Change Display Language'
	,'ShortestPath IDE 设置': 'ShortestPath IDE Settings'
	,'未找到可配置代码片段的语言。': 'No language with configurable snippets was found.'
	,'请先打开一个工作目录，再配置自动格式化。': 'Open a workspace folder before configuring automatic formatting.'
	,'文件名模板覆盖必须是一个 JSON 对象，OJ 简称为键、模板字符串为值。': 'File name template overrides must be a JSON object whose keys are OJ abbreviations and whose values are template strings.'
	,'以条目方式配置；留空的可选字段不会写入。正则请使用捕获组表示比赛和题目 ID。': 'Configure entries individually. Empty optional fields are omitted. Use capture groups in regular expressions for contest and problem IDs.'
	,'更改会自动保存。编译器与编译选项请在 ShortestPath IDE 主设置页统一修改。': 'Changes are saved automatically. Change the compiler and compiler options in the main ShortestPath IDE settings page.'
	,'单个测试点超时（毫秒）': 'Per-test timeout (ms)'
	,'编译成功时隐藏 stderr': 'Hide stderr after successful compilation'
	,'C++ 编译器（CPH）': 'C++ Compiler (CPH)'
	,'C/C++ Compile Run 编译器': 'C/C++ Compile Run Compiler'
	,'与 CPH 使用相同编译器。': 'Uses the same compiler as CPH.'
	,'当前：{0}{1}': 'Current: {0}{1}'
	,'；CPH：{0}': '; CPH: {0}'
	,'CPH 与 Compile Run 一致：{0}': 'CPH and Compile Run match: {0}'
	,'CPH：{0}；Compile Run：{1}': 'CPH: {0}; Compile Run: {1}'
	,'未配置': 'Not configured'
	,'已允许 Homebrew GCC 的所有稳定链接路径。': 'All stable Homebrew GCC link paths are allowed.'
	,'已指向 {0}': 'Points to {0}'
	,'clangd 未配置与当前 C++ 编译器匹配的 --query-driver。': 'clangd has no --query-driver matching the current C++ compiler.'
	,'clangd 系统头文件': 'clangd System Headers'
	,'请先打开一个 C/C++ 源文件，再重新检测。诊断会使用该文件的工作区 .clangd 与当前 clangd 配置，不会直接读取或修改用户全局 clangd 配置。': 'Open a C/C++ source file and detect again. The diagnostic uses that file’s workspace .clangd and current clangd configuration; it does not read or modify the global clangd configuration.'
	,'clangd 未配置或路径不存在，无法检查系统头文件。': 'clangd is not configured or its path does not exist, so system headers cannot be checked.'
	,'无法运行检查：{0}': 'Unable to run the check: {0}'
	,'未配置路径。': 'Path is not configured.'
	,'找不到文件：{0}': 'File not found: {0}'
	,'检测到 Apple Clang 的 g++ 兼容包装器；可以使用，但推荐安装 Homebrew GCC 以保持竞赛环境一致。': 'An Apple Clang g++ compatibility wrapper was detected. It works, but Homebrew GCC is recommended for a consistent competitive-programming environment.'
	,'可执行文件可正常启动。': 'The executable starts normally.'
	,'步骤': 'Steps'
	,'接下来你将依次配置': 'You will configure the following'
	,'代码字体、字号与连字': 'Code font, size, and ligatures'
	,'界面主题': 'Color theme'
	,'默认 C++ 语言版本': 'Default C++ language version'
	,'生成文件自动清理': 'Automatic generated-file cleanup'
	,'CPH 题目文件命名': 'CPH problem file naming'
	,'实时预览': 'Live preview'
	,'主要字体': 'Primary Font'
	,'从检测到的系统等宽字体中选择。': 'Choose from detected system monospaced fonts.'

	,'跟随系统主题': 'Follow System Theme'
	,'开启后随系统亮暗自动切换。': 'Automatically switch with the system light/dark appearance.'
	,'C++ 语言版本': 'C++ Language Version'
	,'由版本自动生成，可在设置页微调。': 'Generated from the version; fine-tune it in Settings.'
	,'编译命令预览': 'Compile Command Preview'
	,'编译成功 ✓  main': 'Compilation succeeded ✓  main'
	,'显示变量类型提示': 'Show Variable Type Hints'
	,'实时效果': 'Live Effect'
	,'保留时间（秒）': 'Retention Time (seconds)'
	,'生成文件保留多少秒后自动删除。': 'How many seconds generated files are kept before deletion.'
	,'运行后': 'After Run'
	,'源码，已保留': 'Source, retained'
	,'秒后删除': ' seconds until deletion'
	,'忽略运行时 stderr': 'Ignore stderr at runtime'
	,'新导入题目的默认语言': 'Default language for imported problems'
	,'不指定时每次导入询问。': 'Ask on every import when unspecified.'
	,'测试数据与可执行文件目录': 'Test data and executable directory'
	,'将 .cph 元数据集中到工作目录根目录': 'Store .cph metadata in the workspace root'
	,'新题文件名包含导入序号': 'Include import index in new problem file names'
	,'打开关联题目文件时自动显示 Judge': 'Show Judge when opening a linked problem file'
	,'默认定义 ONLINE_JUDGE 宏': 'Define the ONLINE_JUDGE macro by default'
	,'文件名模板': 'File name template'
	,'选择预设；仅选择“自定义”后才能手动输入。': 'Choose a preset; manual input is available only for “Custom”.'
	,'命名效果示例': 'Naming preview'
	,'ShortestPath 推荐：<OJ 名称>/<比赛 ID>/<题目编号>': 'ShortestPath recommended: <OJ name>/<contest ID>/<problem ID>'
	,'<OJ 简称>/<比赛 ID>/<题目编号>_<题目名>': '<OJ abbreviation>/<contest ID>/<problem ID>_<problem name>'
	,'<比赛 ID>_<题目编号>_<题目名>': '<contest ID>_<problem ID>_<problem name>'
	,'以 Codeforces 第 2078 场 A 题、C++ 为例；实时预览上方通用模板。': 'Example: Codeforces Round 2078 Problem A in C++; the general template is previewed above.'
	,'可用 OJ 简称：': 'Available OJ abbreviations: '
	,'未解析到，请在在线评测映射中添加': 'None detected; add them in Online Judge Mappings'
	,'AtCoder 使用短文件名': 'Use short file names for AtCoder'
	,'Codeforces 使用短文件名': 'Use short file names for Codeforces'
	,'洛谷使用短文件名': 'Use short file names for Luogu'
	,'题面': 'Problem Statement'
	,'在浏览器中自动显示题目': 'Show problems automatically in the browser'
	,'默认题面来源': 'Default Problem Source'
	,'可在“在线评测映射”中为单个 OJ 覆盖。': 'Override this for individual OJs in Online Judge Mappings.'
	,'原 OJ': 'Original OJ'
	,'文件名模板覆盖': 'File name template overrides'
	,'为不同 OJ 设置专用模板，匹配时优先于通用模板。': 'Set a template for each OJ; matching templates take priority over the global one.'
	,'VJudge URL 后缀': 'VJudge URL suffix'
	,'在浏览器中显示题目': 'Show problems in the browser'
	,'检查 CPH、Compile Run 与 clangd 的实际可执行文件、版本及配置是否一致。黄色表示可继续使用但建议修复，红色表示当前环境无法正常工作。': 'Check whether CPH, Compile Run, and clangd use consistent executables, versions, and configuration. Yellow means usable but recommended to fix; red means the environment cannot work correctly.'
	,'代码字体': 'Code Font'
	,'选择适合长时间阅读的主要等宽字体，并用回退字体补齐缺失字形。': 'Choose a primary monospaced font for long reading and fallback fonts for missing glyphs.'
	,'选择一个你看着顺眼的主题，选择后立即应用到整个 IDE。': 'Choose a theme you like. It is applied to the entire IDE immediately.'
	,'保存或粘贴代码时自动格式化，保持代码风格一致。': 'Format code automatically on save or paste to keep its style consistent.'
	,'全部就绪 🎉': 'All Set 🎉'
	,'你的偏好已保存并实时生效。随时可以在设置页或命令面板重新打开本向导。': 'Your preferences have been saved and applied. You can reopen this guide from Settings or the Command Palette at any time.'
	,'当前字体不是等宽字体，请选择': 'The current font is not monospaced. Please choose one.'
	,'正在检测系统等宽字体…': 'Detecting system monospaced fonts…'
	,'当前字体不支持连字，无法启用。': 'The current font does not support ligatures and cannot be enabled.'
	,'放松模式 🌿': 'Relax Mode 🌿'
	,'写题累了就放松一会儿。点击一个放松源，它会在 Integrated Browser 中打开。': 'Take a break when you are tired from solving problems. Click a source to open it in the Integrated Browser.'
	,'今日放松宣言：编译器可以等，快乐不能等。': 'Today’s reminder: the compiler can wait, happiness cannot.'
	,'放松源': 'Relax Sources'
	,'默认源和自定义源都只会在 IDE 自己的浏览器标签中打开。': 'Both built-in and custom sources open only in the IDE’s own browser tabs.'
	,'还没有放松源，先添加一个吧。': 'There are no relax sources yet. Add one to get started.'
	,'这里可以把 IDE 变成一个合法放松入口。普通编辑器、终端和题目功能不会被改变。': 'This turns the IDE into a permitted place to relax. Editors, terminals, and problem features are unchanged.'
	,'启动后可以用快捷键一键隐藏/显示；隐藏时不会关闭放松源或 Integrated Browser 标签。': 'After starting, use the shortcut to hide or show it. Hiding does not close relax sources or Integrated Browser tabs.'
	,'放松源在哪里管理？': 'Where are relax sources managed?'
	,'进入放松模式主页后，可以添加任意 HTTP / HTTPS 网站。默认已经准备好 bilibili.com 和 poki.com。': 'From the Relax Mode home page, you can add any HTTP or HTTPS website. bilibili.com and poki.com are ready by default.'
};

export function localize(value: string): string {
	return vscode.env.language.toLowerCase().startsWith('zh') ? value : (english[value] ?? value);
}

export function localizeFormat(value: string, ...arguments_: readonly unknown[]): string {
	return localize(value).replace(/\{(\d+)\}/g, (match, index) => index in arguments_ ? String(arguments_[Number(index)]) : match);
}

/**
 * The setup pages are inline Webviews. Keep their markup together, but run it
 * through one language boundary before it reaches the browser. Long sentences
 * intentionally remain keys: this prevents a partial replacement from changing
 * user content injected into a page.
 */
export function localizeWebviewHtml(html: string): string {
	if (vscode.env.language.toLowerCase().startsWith('zh')) {
		return html;
	}
	const strings = JSON.stringify(english).replace(/</g, '\\u003c');
	// Translate only rendered text and accessibility attributes in the browser.
	// In particular, never rewrite the HTML source: inline scripts contain the
	// serialized settings, mappings, and snippets that the page can save back.
	const script = `<script>(()=>{const strings=${strings};const ignored=new Set(['CODE','PRE','SCRIPT','STYLE','TEXTAREA','INPUT']);const translate=value=>{if(strings[value])return strings[value];return value.replace(/^已检测到 (\\d+) 个系统等宽字体。$/,'Detected $1 system monospaced fonts.').replace(/^正在检测 (\\d+) 个系统字体中的等宽字体，请稍候。$/,'Detecting monospaced fonts among $1 system fonts. Please wait.');};const replace=(node,value)=>{if(value!==node.nodeValue)node.nodeValue=value;};const visit=node=>{if(node.nodeType===Node.TEXT_NODE){const parent=node.parentElement;if(parent&&!ignored.has(parent.tagName)&&!parent.closest('[data-i18n-ignore]'))replace(node,translate(node.nodeValue||''));return;}if(!(node instanceof HTMLElement)||ignored.has(node.tagName)||node.closest('[data-i18n-ignore]'))return;for(const attribute of ['aria-label','placeholder','title']){if(node.hasAttribute(attribute)){const value=translate(node.getAttribute(attribute)||'');if(value!==node.getAttribute(attribute))node.setAttribute(attribute,value);}}node.childNodes.forEach(visit);};document.documentElement.lang='en';visit(document.body);new MutationObserver(records=>records.forEach(record=>{if(record.type==='characterData')visit(record.target);else if(record.type==='attributes')visit(record.target);else record.addedNodes.forEach(visit)})).observe(document.body,{childList:true,characterData:true,attributes:true,subtree:true,attributeFilter:['aria-label','placeholder','title']});})();</script>`;
	return html.replace('</body>', `${script}</body>`);
}
