# ShortestPath IDE 下载说明 / Download Guide

**下载、使用本软件即代表同意 GPL-3.0 license 协议**。

## v0.4.5 更新 / What's New

- 浏览模式使用独立原生编辑器容器，统一浏览和做题标签栏的实现，保留各自的标签页。
- 修复浏览页面的完整加载错误页、空网址、新建标签页、圆角、设置弹窗和跨模式网页切换。
- 删除 ShortestPath OJ 页面里的 Add problem；其他网站通过浏览器右上角导入按钮导题，自动选择匹配解析器，也可手动选择；未配置文件名模板时提示输入文件名。
- 恢复做题 New Tab 的新建文件、打开、文档和支持入口；浏览 New Tab 放大专题入口，进入浏览时仅有一个空白标签会打开 ShortestPath OJ。
- 收紧标签栏与左侧模式栏，统一 hover 留白，并取消浏览容器的锁定图标。
- 修复 Error Lens 设置开关，并改进 Judger 的 AC 完成状态和临时目录清理。

### English

- Browsing uses a dedicated native editor container and shares the native tab implementation with solving while keeping separate tabs.
- Fixed full browser error pages, empty URLs, new tabs, rounded borders, settings dialogs, and cross-mode tab switching.
- Removed Add problem from ShortestPath OJ pages. Other websites use the browser toolbar import action, with automatic or manual parser selection and filename prompts when no naming template is configured.
- Restored New File, Open, documentation, and support actions on the solving start page. Enlarged the topic shortcut and open ShortestPath OJ when entering browsing with a single blank tab.
- Compacted tabs and the navigation rail, aligned hover gutters, and removed the browser container lock icon.
- Fixed the Error Lens settings toggle and improved Judger AC completion state and temporary directory cleanup.

## v0.4.4 更新 / What's New

- 新增离线草稿画板，内置 16 个可编辑竞赛绘图模板，支持自动保存、代码旁绘图，以及 Excalidraw、PNG 和 SVG 导出。
- 内置 Fira Code，编辑器、设置及引导预览均可直接使用；字体加载完成后自动刷新字宽测量。
- 首次引导新增字体选择和连字开关，示例代码可即时展示连字效果；保留既有字体设置。
- 代码存放目录选定后立即记住，重新进入引导时恢复；重装保留用户数据即可恢复，便携版支持目录随盘符或位置变化重新定位。
- Windows 改为提供用户安装版与便携版；旧系统安装版的更新入口引导至用户安装包。
- 统一草稿、设置和代码片段页面的边界样式，改善紧凑布局下的显示。

### English

- Added an offline sketchpad with 16 editable competition templates, autosave, drawing beside code, and Excalidraw, PNG, and SVG export.
- Bundled Fira Code for the editor, settings, and setup previews. Font measurements refresh after fonts finish loading.
- Added font selection and a ligature toggle to initial setup, with live ligature examples and preservation of existing font preferences.
- Code folders are remembered immediately and restored when setup reopens. Reinstalling with user data preserved keeps the selection; portable installations rebase folders after drive or location changes.
- Windows now provides a per-user installer and a portable package. Update links for legacy system installations lead to the user installer.
- Unified sketchpad, settings, and snippet page borders, including compact layouts.

## v0.4.3 更新 / What's New

- 修复 Judger 初始化顺序错误，恢复题目样例加载与本地评测，并加入冷启动回归测试。
- 内置浏览器的 ShortestPath 导题入口改用网站的“开始做题”流程，支持页面导航与按钮状态变化。
- 将题目评价移至题面顶部浮层，改善投票后的焦点、浮层边界和悬停交互。
- 题解代码高亮、字体与编辑器主题保持一致，改进浏览器标签标题宽度及拥挤时的滚动显示。

### English

- Fixed Judger initialization order to restore sample loading and local judging, with a cold-start regression test.
- Integrated browser imports on ShortestPath now use the website's Start Solving flow and follow page navigation and button state changes.
- Moved problem ratings into a header popover and improved focus, viewport positioning, and hover behavior after voting.
- Editorial code highlighting and fonts follow the editor theme. Improved browser tab title sizing and scrolling when tabs are crowded.

## v0.4.2 更新 / What's New

- 新增题目与代码配对的解题工作区、内嵌样例和自定义测试；官方样例保持只读，支持编译诊断、取消运行及输出差异。
- 题目快照移入 IDE 私有缓存，只保留最近 30 题；保留代码关联并迁移旧缓存，不删除代码或 Judger 测试文件。
- 完善连接恢复、题目评价、历史题面和报告展示。点赞使用题目快照，支持投票及修改，下次获取题目时同步远端状态。
- 改进首次配置和环境自检、C++ 模板及代码片段编辑、字体和格式预览，并兼容新版 Judger。
- 修复本地开发与安装包的中文翻译加载，保留扩展宿主所需的 Chat、MCP 和 Agent 服务。

### English

- Added paired problem and source workspaces with integrated samples and custom tests. Official samples remain read-only, with compiler diagnostics, cancellation, and output differences.
- Moved problem snapshots to a private IDE cache retaining the latest 30 problems. Source bindings survive eviction; migration preserves source and Judger testcase files.
- Improved connection recovery, ratings, statement history, and reports. Likes use the imported snapshot, support voting and changes, and refresh on the next problem fetch.
- Improved first-run setup, environment checks, C++ templates, snippet editing, font and formatting previews, with support for the current Judger backend.
- Fixed Chinese translation loading in local development and packaged builds while preserving Chat, MCP, and Agent services required by the extension host.

The English version follows the Chinese version.

## 简体中文 / Chinese

> 点一下表格里的文件名，就是直接下载。

| 你的平台 | 下载这个 | 说明 |
| --- | --- | --- |
| Windows x64（大多数人） | [`ShortestPath-IDE-Windows-x64-User-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-User-Setup.exe) | 当前用户安装，**内置 MinGW Lite GCC**，无需管理员权限，装完即用、离线可用 |
| Windows x64，要 U 盘便携版（推荐） | [`ShortestPath-IDE-Windows-x64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64.zip) | 解压即用，**内置 MinGW Lite GCC**；设置、插件和工具链保存在安装目录的 `data` 中，可随 U 盘移动 |
| macOS（Apple Silicon，M 系列）| [`ShortestPath-IDE-macos-arm64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip) | 唯一选择；解压后拖入「应用程序」，首次打开被拦截请看下方指南 |
| Linux x64（大多数发行版） | [`ShortestPath-IDE-linux-x64.tar.gz`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-linux-x64.tar.gz) | 解压后在目录中运行 `shortestpath`；**不含编译器**，向导会调用系统包管理器安装 g++ 并下载 clangd |
| Linux x64（Debian / Ubuntu） | [`ShortestPath-IDE-linux-x64.deb`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-linux-x64.deb) | 双击安装，或执行 `sudo apt install ./ShortestPath-IDE-linux-x64.deb`；同样不含编译器 |

Windows 仅提供用户安装版与便携版。此前使用系统安装版的用户，建议先卸载旧版，再安装用户版。

### macOS（Apple Silicon）

- **只发布 [`ShortestPath-IDE-macos-arm64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip) 这一个文件**，仅支持 Apple Silicon（M 系列芯片），不支持 Intel Mac。
- 下载后双击解压 → 把 `ShortestPath IDE.app` 拖进「应用程序」→ 首次打开若被 Gatekeeper 拦截（「已损坏，无法打开」/「无法验证开发者」），执行：

```bash
xattr -c "/Applications/ShortestPath IDE.app"
```

- 完整图文步骤与常见问题见 [macOS 安装指南（简体中文）](https://github.com/KevinHuangIsLearning/shortestpath-ide/blob/main/docs/macos-install.md) ／ [macOS Installation Guide (English)](https://github.com/KevinHuangIsLearning/shortestpath-ide/blob/main/docs/macos-install.en.md)。
- 编译器不在安装包里：首次运行向导会通过 Homebrew 安装 GCC 与 LLVM（clangd），依赖网络。

### Linux（x64）

- 只提供 x64，构建于 Ubuntu 22.04，需要 glibc 2.35 及以上（Ubuntu 22.04+ / Debian 12+ / Fedora 36+ 等）。
- 两种形态：`.tar.gz` 解压后在解压出的目录中运行 `shortestpath` 启动；`.deb` 面向 Debian / Ubuntu，双击安装或执行 `sudo apt install ./ShortestPath-IDE-linux-x64.deb`，装好后同样用 `shortestpath` 启动。
- 编译器不在包里：首次运行向导会调用你发行版的包管理器安装 g++（需要输入 sudo 密码），并从网络下载 clangd。

## English / 英语

> Can't decide? Just read the table. **When in doubt, pick the first row for your platform.**

### Quick Overview

> Click a file name in the table to download it directly.

| Your Platform                            | Download This                                                | Notes                                                        |
| :--------------------------------------- | :----------------------------------------------------------- | :----------------------------------------------------------- |
| Windows x64 (Most users)                 | [\`ShortestPath-IDE-Windows-x64-User-Setup.exe\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-User-Setup.exe) | Per-user installation; **includes MinGW Lite GCC**; no admin rights needed; ready to use immediately; works offline. |
| Windows x64 (Portable version)           | [\`ShortestPath-IDE-Windows-x64.zip\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64.zip) | Extract and run; **includes MinGW Lite GCC**; settings, extensions, and the toolchain stay in the adjacent `data` directory and travel with a USB drive. |
| macOS (Apple Silicon / M-series)         | [\`ShortestPath-IDE-macos-arm64.zip\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip) | The only option; extract and drag to "Applications"; see the guide below if blocked upon first launch. |
| Linux x64 (Most distributions)           | [\`ShortestPath-IDE-linux-x64.tar.gz\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-linux-x64.tar.gz) | Extract and run \`shortestpath\`; **no compiler bundled** — the wizard installs g++ with your distribution's package manager and downloads clangd. |
| Linux x64 (Debian / Ubuntu)              | [\`ShortestPath-IDE-linux-x64.deb\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-linux-x64.deb) | Double-click, or run \`sudo apt install ./ShortestPath-IDE-linux-x64.deb\`; also ships without a compiler. |

Windows provides a per-user installer and a portable package. If you previously used the system-wide installer, uninstall it before installing the per-user version.

### macOS (Apple Silicon)

- **Only one file is released: [\`ShortestPath-IDE-macos-arm64.zip\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip)**; it supports Apple Silicon (M-series chips) only and does not support Intel Macs.
- After downloading, double-click to unzip → drag `ShortestPath IDE.app` into the "Applications" folder → if Gatekeeper blocks the app upon first launch (e.g., "damaged and can't be opened" or "developer cannot be verified"), run this command:

```bash
xattr -c "/Applications/ShortestPath IDE.app"
```

- For full illustrated steps and FAQs, see the [macOS Installation Guide (Simplified Chinese)](https://github.com/KevinHuangIsLearning/shortestpath-ide/blob/main/docs/macos-install.md) / [macOS Installation Guide (English)](https://github.com/KevinHuangIsLearning/shortestpath-ide/blob/main/docs/macos-install.en.md).
- The compiler is not included in the installation package: the first-run wizard installs GCC and LLVM (clangd) via Homebrew, which requires an internet connection.

### Linux (x64)

- x64 only, built on Ubuntu 22.04, requiring glibc 2.35 or newer (Ubuntu 22.04+, Debian 12+, Fedora 36+, …).
- Two formats: extract the `.tar.gz` and run `shortestpath` from the extracted directory; the `.deb` targets Debian / Ubuntu — double-click it, or run `sudo apt install ./ShortestPath-IDE-linux-x64.deb`, then start it with `shortestpath`.
- The compiler is not bundled: the first-run wizard installs g++ through your distribution's package manager (it will ask for your sudo password) and downloads clangd from the network.
