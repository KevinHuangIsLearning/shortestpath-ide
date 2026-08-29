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
	,'正在检查更新…': 'Checking for updates…'
	,'当前已是 ShortestPath IDE 最新版本（{0}）。': 'ShortestPath IDE is up to date ({0}).'
	,'发现 ShortestPath IDE 新版本（{0}），请查看更新窗口。': 'A new ShortestPath IDE version is available ({0}). See the update window.'
	,'检查更新失败，请稍后重试。': 'Update check failed. Please try again later.'
	,'检查更新失败：{0}': 'Update check failed: {0}'
	,'更新检查命令未返回结果，可能是扩展尚未激活。': 'The update command returned no result. The extension may not be active yet.'
	,'未返回具体原因。': 'No specific reason was provided.'
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
	,'题面来源': 'Problem Source'
	,'留空时使用 CPH 设置中的默认题面来源。': 'Leave blank to use the default problem source from CPH Settings.'
	,'使用默认值': 'Use Default'
	,'不显示': 'Do Not Show'
	,'无法运行：{0}': 'Unable to run: {0}'
	,'已安装（{0}）。': 'Installed ({0}).'
	,'未知版本': 'Unknown version'
	,'未安装或未随应用打包。': 'Not installed or not bundled with the application.'
	,'当前已是最新版本。': 'You are up to date.'
	,'发现新版本，请查看更新窗口。': 'A new version is available. See the update window.'
	,'浏览器分栏比例（10–90）': 'Browser split ratio (10–90)'
	,'可为每个 OJ 设置题面来源。': 'Configure the problem source for each OJ.'
	,'用几步配置好你的竞赛编程环境偏好。所有改动都会实时生效，随时可以返回调整。': 'Configure your competitive-programming preferences in a few steps. Changes take effect immediately, and you can return at any time.'
	,'① 代码字体、字号与连字': '① Code font, size, and ligatures'
	,'② 界面主题': '② Color theme'
	,'③ 默认 C++ 语言版本': '③ Default C++ language version'
	,'④ clangd 变量类型提示': '④ clangd variable type hints'
	,'⑤ 生成文件自动清理': '⑤ Automatic generated-file cleanup'
	,'⑥ 自动保存': '⑥ Auto Save'
	,'⑦ 自动格式化': '⑦ Automatic formatting'
	,'⑧ CPH 题目文件命名': '⑧ CPH problem file naming'
	,'⑨ 代码模板': '⑨ Code snippets'
	,'1 / 9 · 字体': '1 / 9 · Fonts'
	,'2 / 9 · 主题': '2 / 9 · Theme'
	,'3 / 9 · 编译': '3 / 9 · Compilation'
	,'4 / 9 · 智能提示': '4 / 9 · IntelliSense'
	,'5 / 9 · 文件': '5 / 9 · Files'
	,'6 / 9 · 保存': '6 / 9 · Saving'
	,'7 / 9 · 格式化': '7 / 9 · Formatting'
	,'8 / 9 · CPH': '8 / 9 · CPH'
	,'9 / 9 · 模板': '9 / 9 · Snippets'
	,'配置会实时保存到当前工作目录的': 'Settings are saved immediately to'
	,'，并可选择同时启用保存和粘贴时格式化。': ', with optional formatting on save and paste.'
	,'同时开启保存时格式化和粘贴时格式化。': 'Enable formatting on both save and paste.'
	,'通用': 'General'
	,'基础风格（BasedOnStyle）': 'Base Style (BasedOnStyle)'
	,'作为其他规则未覆盖部分的基准；下面的选项会覆盖它。': 'The baseline for rules not covered elsewhere; the options below override it.'
	,'Google（Google C++ 风格）': 'Google (Google C++ style)'
	,'LLVM（LLVM 默认风格）': 'LLVM (LLVM default style)'
	,'Chromium（Chromium 项目风格）': 'Chromium (Chromium project style)'
	,'Mozilla（Mozilla 项目风格）': 'Mozilla (Mozilla project style)'
	,'WebKit（WebKit 项目风格）': 'WebKit (WebKit project style)'
	,'行为': 'Behavior'
	,'控制短小 if / else 是否可以保持在同一行。': 'Controls whether short if / else statements may remain on one line.'
	,'Never（始终换行）': 'Never (always wrap)'
	,'WithoutElse（仅无 else 时允许）': 'WithoutElse (only without else)'
	,'OnlyFirstIf（仅 if-else 链的第一个 if）': 'OnlyFirstIf (only the first if in an if-else chain)'
	,'AllIfsAndElse（if 与 else 都允许）': 'AllIfsAndElse (allow both if and else)'
	,'允许单行循环': 'Allow Short Loops on a Single Line'
	,'如': 'For example,'
	,'不强制拆成多行。': 'does not have to be split across lines.'
	,'允许': 'Allow'
	,'允许单行代码块': 'Allow Short Blocks on a Single Line'
	,'控制短小函数是否保持为一行。': 'Controls whether short functions may remain on one line.'
	,'None（所有函数拆行）': 'None (split all functions)'
	,'InlineOnly（仅 inline 函数）': 'InlineOnly (inline functions only)'
	,'Empty（仅空函数）': 'Empty (empty functions only)'
	,'Inline（允许 inline 函数）': 'Inline (allow inline functions)'
	,'All（所有短函数都允许）': 'All (allow every short function)'
	,'行长与缩进': 'Line Length and Indentation'
	,'最大行长（ColumnLimit）': 'Maximum Line Length (ColumnLimit)'
	,'超过该长度时 clang-format 会尝试换行；0 表示不限行长。': 'clang-format tries to wrap lines beyond this length; 0 means unlimited.'
	,'缩进宽度（IndentWidth）': 'Indent Width (IndentWidth)'
	,'每一级缩进使用的空格数。': 'Number of spaces used for each indentation level.'
	,'制表符宽度（TabWidth）': 'Tab Width (TabWidth)'
	,'Tab 显示或等效为多少个空格。': 'Number of spaces displayed or represented by a tab.'
	,'Tab 使用方式（UseTab）': 'Tab Usage (UseTab)'
	,'控制缩进时是否实际写入 Tab 字符。': 'Controls whether indentation writes tab characters.'
	,'Never（始终使用空格）': 'Never (always use spaces)'
	,'ForIndentation（仅基础缩进使用 Tab）': 'ForIndentation (tabs for indentation only)'
	,'ForContinuationAndIndentation（缩进和续行都使用 Tab）': 'ForContinuationAndIndentation (tabs for indentation and continuation)'
	,'Always（尽可能使用 Tab）': 'Always (use tabs whenever possible)'
	,'访问修饰符缩进（AccessModifierOffset）': 'Access Modifier Indent (AccessModifierOffset)'
	,'public / private / protected 相对类成员的缩进偏移；负数表示向左。': 'Indent offset of public / private / protected relative to class members; negative values shift left.'
	,'大括号、指针与代码块': 'Braces, Pointers, and Blocks'
	,'大括号位置（BreakBeforeBraces）': 'Brace Position (BreakBeforeBraces)'
	,'控制函数、类、if 等代码块的左大括号是否另起一行。': 'Controls whether opening braces for functions, classes, if blocks, and similar constructs start on a new line.'
	,'Attach（左大括号不换行）': 'Attach (keep opening braces on the same line)'
	,'Linux（函数、命名空间和类定义换行）': 'Linux (wrap functions, namespaces, and class definitions)'
	,'Mozilla（枚举、函数和类/结构体定义换行）': 'Mozilla (wrap enums, functions, and class/struct definitions)'
	,'Stroustrup（函数、else 和 catch 换行）': 'Stroustrup (wrap functions, else, and catch)'
	,'Allman（所有左大括号换行）': 'Allman (wrap every opening brace)'
	,'Whitesmiths（大括号换行并额外缩进）': 'Whitesmiths (wrap and indent braces)'
	,'GNU（GNU 风格）': 'GNU (GNU style)'
	,'WebKit（函数定义左大括号换行）': 'WebKit (wrap opening braces for function definitions)'
	,'Custom（使用 BraceWrapping 的细分规则）': 'Custom (use detailed BraceWrapping rules)'
	,'模板声明换行（AlwaysBreakTemplateDeclarations）': 'Template Declaration Wrapping (AlwaysBreakTemplateDeclarations)'
	,'控制': 'Controls whether'
	,'与后续声明是否分为两行。': 'and the following declaration are split across lines.'
	,'No（尽量不换行）': 'No (avoid wrapping)'
	,'Yes（始终换行）': 'Yes (always wrap)'
	,'MultiLine（仅后续声明本身多行时换行）': 'MultiLine (wrap only when the following declaration is multiline)'
	,'指针星号位置（PointerAlignment）': 'Pointer Alignment (PointerAlignment)'
	,'靠近类型、变量名，还是两者之间。': 'Places the asterisk next to the type, the variable name, or between them.'
	,'行尾注释前空格（SpacesBeforeTrailingComments）': 'Spaces Before Trailing Comments (SpacesBeforeTrailingComments)'
	,'中注释前的空格数。': 'controls the number of spaces before the comment.'
	,'定义块间空行（SeparateDefinitionBlocks）': 'Blank Lines Between Definition Blocks (SeparateDefinitionBlocks)'
	,'控制相邻函数、类等定义之间是否插入空行。': 'Controls whether blank lines are inserted between adjacent functions, classes, and other definitions.'
	,'Leave（保留原有空行）': 'Leave (preserve existing blank lines)'
	,'Never（不额外插入空行）': 'Never (do not insert blank lines)'
	,'Always（相邻定义之间始终插入空行）': 'Always (insert blank lines between adjacent definitions)'
	,'C++ 语言标准（Standard）': 'C++ Language Standard (Standard)'
	,'用于判断可使用的语法和格式化规则。': 'Determines the available syntax and formatting rules.'
	,'Auto（自动判断）': 'Auto (detect automatically)'
	,'Latest（使用最新支持标准）': 'Latest (use the latest supported standard)'
	,'打开 .clang-format': 'Open .clang-format'
	,'字形缺失时按顺序回退，可选择中文 / Emoji 等字体。': 'Fallback in order for missing glyphs; CJK and Emoji fonts are supported.'
	,'选择默认编译使用的 C++ 标准，会同步应用到 CPH 与编译运行。': 'Choose the default C++ standard used by both CPH and Compile Run.'
	,'编译成功 ✓ main': 'Compilation succeeded ✓ main'
	,'在': 'Show the inferred type after'
	,'等推断变量后显示推断出的类型。': 'and other inferred variables.'
	,'程序运行结束后自动删除生成的可执行文件，保持目录干净。': 'Delete generated executables after the program exits to keep the folder clean.'
	,'按你的习惯选择保存时机，避免忘记保存。': 'Choose when files are saved to avoid losing changes.'
	,'状态栏效果': 'Status Bar Preview'
	,'● 未保存 · 需手动保存（Cmd+S）': '● Unsaved · Save manually (Cmd+S)'
	,'同时在保存和粘贴时格式化代码。': 'Format code on both save and paste.'
	,'详细设置': 'Detailed Settings'
	,'配置 .clang-format 的代码风格与缩进规则。': 'Configure code style and indentation rules in .clang-format.'
	,'导入题目时按在线评测、比赛和题号自动组织文件。': 'Organize imported problems by online judge, contest, and problem ID.'
	,'启用自定义文件名': 'Enable Custom File Names'
	,'关闭后 CPH 使用其默认命名；开启后使用 ShortestPath IDE 的推荐模板。': 'When disabled, CPH uses its default naming. When enabled, it uses the ShortestPath IDE template.'
	,'自定义占位符': 'Template Placeholders'
	,'OJ 简称，': 'OJ abbreviation, '
	,'OJ 全称，': 'OJ name, '
	,'比赛 ID，': 'contest ID, '
	,'题号，': 'problem ID, '
	,'题名简写，': 'problem slug, '
	,'题名，': 'problem name, '
	,'导入序号，': 'import index, '
	,'分组，': 'group, '
	,'链接，': 'URL, '
	,'扩展名，': 'extension, '
	,'语言。': 'language.'
	,'按 OJ 简称设置专用模板；匹配时优先于上方的通用模板。': 'Set templates by OJ abbreviation; matching templates override the global template above.'
	,'按 OJ 配置文件名模板、覆盖规则及其他 CPH 行为。': 'Configure per-OJ file-name templates, overrides, and other CPH behavior.'
	,'打开 CPH 设置': 'Open CPH Settings'
	,'配置 C++ 用户代码片段，写题时一键插入常用代码。': 'Configure C++ user snippets for quickly inserting common code.'
	,'打开独立的代码模板配置页，可定义多个语言的片段。': 'Open the dedicated snippet editor to define snippets for multiple languages.'
	,'示例模板': 'Example Snippet'
	,'// 输入 cpp 回车：': '// Type cpp and press Enter:'
	,'字体：': 'Font: '
	,'主题：': 'Theme: '
	,'C++ 版本：': 'C++ Version: '
	,'变量类型提示：': 'Variable Type Hints: '
	,'自动清理：': 'Automatic Cleanup: '
	,'自动格式化：': 'Automatic Formatting: '
	,'CPH 文件名：': 'CPH File Names: '
	,'正在检测': 'Detecting'
	,'默认快捷键：Cmd/Ctrl + Alt + F。点击“自定义快捷键”可在 VS Code 键盘快捷方式中修改。': 'Default shortcut: Cmd/Ctrl + Alt + F. Select “Customize Shortcut” to change it in VS Code Keyboard Shortcuts.'
	,'例如：知乎、猫猫图片': 'For example: Zhihu or cat pictures'
	,'设置分类': 'Settings Categories'
	,'当前代码字体不是等宽字体，请选择': 'The current code font is not monospaced. Choose another font.'
	,'编辑语言': 'Language'
	,'模板列表': 'Snippet List'
	,'更改会自动保存到当前编辑语言对应的用户片段文件。输入触发前缀后，可在相应语言文件中使用补全展开模板。': 'Changes are saved automatically to the user snippet file for the selected language. Type a prefix to expand the snippet through completions.'
	,'删除模板': 'Delete Snippet'
	,'打开 JSON': 'Open JSON'
	,'新建模板': 'New Snippet'
	,'还没有模板。点击左侧 ＋ 新建一个。': 'No snippets yet. Select ＋ on the left to create one.'
	,'{oj} OJ 简称；{ojName} OJ 全称；{contestId} 比赛 ID；{problemId} 题号；{slug} 题名简写；{name} 题名；{index} 导入序号；{group} 分组；{url} 链接；{ext} 扩展名；{lang} 语言。': '{oj} OJ abbreviation; {ojName} OJ name; {contestId} contest ID; {problemId} problem ID; {slug} problem slug; {name} problem name; {index} import index; {group} group; {url} URL; {ext} extension; {lang} language.'
	,'例如：{oj}/{contestId}/{problemId}_{slug}.{ext}': 'For example: {oj}/{contestId}/{problemId}_{slug}.{ext}'
	,'OJ 简称': 'OJ abbreviation'
	,'Competitive Programming Helper（CPH）': 'Competitive Programming Helper (CPH)'
	,'clangd 扩展': 'clangd Extension'
	,'未发现可用的系统等宽字体，无法选择主要字体。': 'No system monospaced fonts are available, so a primary font cannot be selected.'
	,'已保留': 'Retained'
	,'✓ 已自动保存 · 延迟后': '✓ Saved automatically · After delay'
	,'✓ 已自动保存 · 切换焦点时': '✓ Saved automatically · On focus change'
	,'✓ 已自动保存 · 切换窗口时': '✓ Saved automatically · On window change'
	,'编辑器默认': 'Editor default'
	,'延迟后': 'After delay'
	,'切换焦点时': 'On focus change'
	,'切换窗口时': 'On window change'
	,'自定义命名': 'Custom naming'
	,'CPH 默认命名': 'CPH default naming'
	,'（未设置）': '(not set)'
	,'CPH 文件名模板覆盖必须是一个 JSON 对象，OJ 简称为键、模板字符串为值。': 'CPH file-name template overrides must be a JSON object whose keys are OJ abbreviations and whose values are template strings.'
	,'无法打开放松源：{0}': 'Could not open the relax source: {0}'
	,'无法读取 {0}.json。请检查 JSON 格式。': 'Could not read {0}.json. Check its JSON syntax.'
	,'确定删除模板“{0}”吗？删除后会立即保存到 {1}.json。': 'Delete snippet “{0}”? The change will be saved to {1}.json immediately.'
	,'未命名模板': 'Untitled Snippet'
	,'Open VSX 是独立的第三方插件市场。其内容不由 ShortestPath IDE 审核、担保或提供支持；安装第三方扩展可能执行代码并访问你的工作区数据。': 'Open VSX is an independent third-party extension marketplace. Its content is not reviewed, guaranteed, or supported by ShortestPath IDE; third-party extensions may execute code and access workspace data.'
	,'启用后，你需要自行判断扩展的来源、权限、安全性与许可证，并承担相应风险。': 'After enabling it, you are responsible for evaluating each extension\'s source, permissions, security, and license.'
	,'我已了解并启用': 'I Understand and Enable'
	,'ShortestPath IDE 已配置为使用便携工具链。下载将在设置终端中继续，不会修改系统 PATH。': 'ShortestPath IDE is configured for its portable toolchain. The download continues in the setup terminal without changing your system PATH.'
	,'预设已保存，但一个或多个编译器尚未安装。请完成终端安装，然后再次运行“ShortestPath IDE: Configure Competitive Programming Environment”以检测其实际路径。': 'The preset was saved, but one or more compilers are not installed yet. Finish the terminal installer, then run “ShortestPath IDE: Configure Competitive Programming Environment” again to detect their actual paths.'
	,'ShortestPath IDE 已就绪。正在使用 {0}。': 'ShortestPath IDE is ready. Using {0}.'
	,'便携工具链由首次启动设置窗口下载。请重新启动设置以完成下载。': 'Portable toolchains are downloaded by the first-run setup window. Restart setup to download them.'
	,'立即重新启动设置': 'Restart Setup Now'
	,'未能读取系统字体。请检查系统字体服务后重新打开此页面。': 'Could not read system fonts. Check the system font service, then reopen this page.'
	,'系统等宽字体': 'System Monospaced Fonts'
	,'系统字体': 'System Fonts'
	,'未发现可用的系统字体，无法选择代码字体。': 'No system fonts are available, so a code font cannot be selected.'
	,'未发现可用的系统等宽字体，无法选择代码字体。': 'No system monospaced fonts are available, so a code font cannot be selected.'
	,'检测系统等宽字体时出现错误。': 'An error occurred while detecting system monospaced fonts.'
	,'模板名称': 'Snippet Name'
	,'触发前缀': 'Prefix'
	,'触发：': 'Prefix: '
	,'模板内容': 'Snippet Body'
	,'说明（可选）': 'Description (optional)'
	,'Include（逗号分隔，可选）': 'Include (comma-separated, optional)'
	,'Exclude（逗号分隔，可选）': 'Exclude (comma-separated, optional)'
	,'新模板': 'New Snippet'
	,'尚未设置触发前缀': 'No prefix set'
	,'这个放松源已经添加过了。': 'This relax source has already been added.'
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
	const script = `<script>(()=>{const strings=${strings};const ignoredText=new Set(['CODE','PRE','SCRIPT','STYLE','TEXTAREA','INPUT']);const translate=value=>{if(strings[value])return strings[value];return value.replace(/^(.+)（当前字体）$/,'$1 (current font)').replace(/^已检测到 (\\d+) 个系统等宽字体。$/,'Detected $1 system monospaced fonts.').replace(/^正在检测 (\\d+) 个系统字体中的等宽字体，请稍候。$/,'Detecting monospaced fonts among $1 system fonts. Please wait.').replace(/^可用 OJ 简称：(.*)$/,'Available OJ abbreviations: $1').replace(/^已安装（(.+)）。$/,'Installed ($1).').replace(/^(\\d+) 秒后删除$/,'Delete after $1 seconds').replace(/^编辑器默认 · (.+)$/,'Editor default · $1');};const replace=(node,value)=>{if(value!==node.nodeValue)node.nodeValue=value;};const visit=node=>{if(node.nodeType===Node.TEXT_NODE){const parent=node.parentElement;if(parent&&!ignoredText.has(parent.tagName)&&!parent.closest('[data-i18n-ignore]'))replace(node,translate(node.nodeValue||''));return;}if(!(node instanceof HTMLElement)||node.closest('[data-i18n-ignore]'))return;for(const attribute of ['aria-label','placeholder','title']){if(node.hasAttribute(attribute)){const value=translate(node.getAttribute(attribute)||'');if(value!==node.getAttribute(attribute))node.setAttribute(attribute,value);}}if(ignoredText.has(node.tagName))return;node.childNodes.forEach(visit);};document.documentElement.lang='en';visit(document.body);new MutationObserver(records=>records.forEach(record=>{if(record.type==='characterData')visit(record.target);else if(record.type==='attributes')visit(record.target);else record.addedNodes.forEach(visit)})).observe(document.body,{childList:true,characterData:true,attributes:true,subtree:true,attributeFilter:['aria-label','placeholder','title']});})();</script>`;
	return html.replace('</body>', `${script}</body>`);
}
