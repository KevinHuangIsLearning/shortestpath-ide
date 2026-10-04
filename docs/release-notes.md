# ShortestPath IDE 下载说明 / Download Guide

**下载、使用本软件即代表同意 GPL-3.0 license 协议**。

## v0.4.0 更新 / What's New

- 内置浏览器新增网页右下角的「＋ 导入题目」悬浮按钮，使用 Competitive Companion 解析器导入题目或比赛题目；刷新、跳转后自动恢复按钮，导入期间防止重复点击，也可从命令面板发起导入。
- Judger 新增本地「部分 AC」标记；AC 与部分 AC 均需二次确认，并停止计时。取消标记后从冻结的用时继续，不计入暂停期间；ShortestPath OJ 仍使用服务端状态。
- 修复多根工作区中 `.shortestpath` 目录的归属问题，按源文件所在的工作区根目录保存，并兼容迁移旧目录中的题目数据。
- 大样例拖入提示改为按题目保存关闭状态，切换题目后会再次显示；关闭当前题目的提示不会影响其他题目。
- 大样例输出的文本预览缩减为前 5 行 diff，完整内容仍可通过文件查看。
- 独立浏览器窗口恢复默认标题规则，显示网页标题和工作区信息。
- 修复 macOS 应用在 Finder 中显示 VS Code 核心版本的问题，改为显示 ShortestPath IDE 的产品版本。
- 新增 Linux x64 发布包，提供 `.tar.gz` 与 `.deb` 两种形态。构建于 Ubuntu 22.04，需要 glibc 2.35 及以上。安装包不含编译器，首次运行向导会调用发行版包管理器安装 g++ 并下载 clangd。
- 简化设置新增「缩进」选项，可选择缩进宽度与缩进字符，并同步写入工作目录的 `.clang-format`，避免自动格式化把代码改成 2 空格缩进。
- 简化设置新增 Error Lens 行内错误提示开关。
- 开箱配置默认不再启用自动格式化；`.clang-format` 的写入改为只修改缩进相关选项，保留你自己添加的选项与注释，也不再向非 OI 工程写入。
- 修复升级迁移标记只对第一个打开的工作目录生效的问题。
- 修复「请我喝杯咖啡」入口的界面文案未跟随语言设置的问题，并让该卡片的两个按钮铺满整行。
- Windows 标题栏左上角的侧边栏开关不再紧贴窗口边缘。

- Added a floating “+ Import problem” button in the bottom-right corner of integrated browser pages. It uses Competitive Companion parsers to import problems or contest problems, returns after reloads and navigation, and prevents duplicate imports while busy. Import is also available from the Command Palette.
- Added a local Partial AC status in Judger. Both AC and Partial AC require a second click to confirm and freeze the timer. Cancelling either status resumes from the frozen duration, excluding time spent paused. ShortestPath OJ continues to use server-side status.
- Fixed `.shortestpath` storage placement in multi-root workspaces. Problems are saved under the workspace containing their source file, with migration support for data in older locations.
- The large-testcase drop hint now remembers dismissal per problem. Switching problems shows the hint again, and dismissing it for one problem does not affect others.
- Limited the inline diff preview for large-testcase output to the first five lines. The full content remains available through the file.
- Restored default window titles for detached browser windows, including the page title and workspace information.
- Fixed the macOS app version shown in Finder to use the ShortestPath IDE product version instead of the VS Code core version.
- Added Linux x64 release packages in two formats: `.tar.gz` and `.deb`. Built on Ubuntu 22.04, requiring glibc 2.35 or newer. No compiler is bundled — the first-run wizard installs g++ through your distribution's package manager and downloads clangd.
- Added an Indentation option to Simplified Settings for indent width and indent character, written into the workspace `.clang-format` so formatted code no longer falls back to clang-format's default 2-space indentation.
- Added an Error Lens toggle to Simplified Settings for inline diagnostics at the end of the offending line.
- Auto formatting is no longer enabled by default in the first-run setup. `.clang-format` writes now change only the indentation options, preserving your own options and comments, and ShortestPath no longer writes a `.clang-format` into non-OI projects.
- Fixed the upgrade migration flag only applying to the first workspace that was opened.
- Fixed the "Buy Me a Coffee" entry not following the configured display language, and made its two buttons span the full row.
- The sidebar toggle in the top-left corner of the Windows title bar no longer sits flush against the window edge; the web build is handled the same way.

The English version follows the Chinese version.

## 简体中文 / Chinese

> 点一下表格里的文件名，就是直接下载。

| 你的平台 | 下载这个 | 说明 |
| --- | --- | --- |
| Windows x64（大多数人） | [`ShortestPath-IDE-Windows-x64-User-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-User-Setup.exe) | 当前用户安装，**内置 MinGW Lite GCC**，无需管理员权限，装完即用、离线可用 |
| Windows x64，要 U 盘便携版（推荐） | [`ShortestPath-IDE-Windows-x64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64.zip) | 解压即用，**内置 MinGW Lite GCC**；设置、插件和工具链保存在安装目录的 `data` 中，可随 U 盘移动 |
| Windows x64，系统级安装 | [`ShortestPath-IDE-Windows-x64-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-Setup.exe) | 系统级安装（需管理员），**内置 MinGW Lite GCC**，给这台机器所有用户用 |
| macOS（Apple Silicon，M 系列）| [`ShortestPath-IDE-macos-arm64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip) | 唯一选择；解压后拖入「应用程序」，首次打开被拦截请看下方指南 |
| Linux x64（大多数发行版） | [`ShortestPath-IDE-linux-x64.tar.gz`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-linux-x64.tar.gz) | 解压后在目录中运行 `shortestpath`；**不含编译器**，向导会调用系统包管理器安装 g++ 并下载 clangd |
| Linux x64（Debian / Ubuntu） | [`ShortestPath-IDE-linux-x64.deb`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-linux-x64.deb) | 双击安装，或执行 `sudo apt install ./ShortestPath-IDE-linux-x64.deb`；同样不含编译器 |

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
| Windows x64 (System-wide)                | [\`ShortestPath-IDE-Windows-x64-Setup.exe\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-Setup.exe) | System-wide installation (requires administrator privileges); **includes MinGW Lite GCC**; for all users on the machine. |
| macOS (Apple Silicon / M-series)         | [\`ShortestPath-IDE-macos-arm64.zip\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip) | The only option; extract and drag to "Applications"; see the guide below if blocked upon first launch. |
| Linux x64 (Most distributions)           | [\`ShortestPath-IDE-linux-x64.tar.gz\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-linux-x64.tar.gz) | Extract and run \`shortestpath\`; **no compiler bundled** — the wizard installs g++ with your distribution's package manager and downloads clangd. |
| Linux x64 (Debian / Ubuntu)              | [\`ShortestPath-IDE-linux-x64.deb\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-linux-x64.deb) | Double-click, or run \`sudo apt install ./ShortestPath-IDE-linux-x64.deb\`; also ships without a compiler. |

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
