# ShortestPath IDE 下载说明 / Download Guide

**下载、使用本软件即代表同意 GPL-3.0 license 协议**。

## v0.3.16 更新 / What's New

- 升级至 VS Code 1.137.0 内核。
- 默认启用现代 UI；Windows 标题栏使用更紧凑的菜单入口，并简化窗口图标显示。
- 修复 VS Code 内核升级后聊天、语言模型、MCP 等协议服务未完整注册时，可能导致扩展宿主无法启动的问题。
- 改进更新检查：GitHub 更新清单不可用时自动尝试 GitCode 镜像；强制更新遇到网络问题时可临时继续使用 15 分钟；快速下载链接兼容性更好。
- 主页和简化设置新增使用文档与项目支持入口，主页操作按用途分组显示。使用文档以及 CPH 设置中的 Competitive Champion 文档现会在系统外部浏览器中打开。
- 修复从简化设置打开工具链诊断时，诊断页未以 modal 打开且被设置页遮挡的问题。

- Upgraded the VS Code core to 1.137.0.
- Enabled Modern UI by default. On Windows, the title bar now uses a more compact menu entry and a simplified app-icon layout.
- Fixed an issue introduced during the core upgrade where missing chat, language-model, MCP, and related protocol service registrations could prevent the extension host from starting.
- Improved update checks: the GitCode mirror is tried automatically when the GitHub update manifest is unavailable, required updates can grant a temporary 15-minute network grace period, and fast-download links accept more URL formats.
- Added documentation and project-support entries to the Home page and Simplified Settings, with Home page actions grouped by purpose. Documentation and the Competitive Champion guide in CPH Settings now open in the system browser.
- Fixed Toolchain Diagnostics opened from Simplified Settings not appearing as a modal and being covered by the Settings modal.

The English version follows the Chinese version.

## 简体中文 / Chinese

> 点一下表格里的文件名，就是直接下载。

| 你的平台 | 下载这个 | 说明 |
| --- | --- | --- |
| Windows x64（大多数人） | [`ShortestPath-IDE-Windows-x64-User-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-User-Setup.exe) | 当前用户安装，**内置 MinGW Lite GCC**，无需管理员权限，装完即用、离线可用 |
| Windows x64，要 U 盘便携版（推荐） | [`ShortestPath-IDE-Windows-x64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64.zip) | 解压即用，**内置 MinGW Lite GCC**；设置、插件和工具链保存在安装目录的 `data` 中，可随 U 盘移动 |
| Windows x64，系统级安装 | [`ShortestPath-IDE-Windows-x64-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-Setup.exe) | 系统级安装（需管理员），**内置 MinGW Lite GCC**，给这台机器所有用户用 |
| macOS（Apple Silicon，M 系列）| [`ShortestPath-IDE-macos-arm64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip) | 唯一选择；解压后拖入「应用程序」，首次打开被拦截请看下方指南 |
| Linux | — | 暂不提供发布包，请自行从源码构建 |

### macOS（Apple Silicon）

- **只发布 [`ShortestPath-IDE-macos-arm64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip) 这一个文件**，仅支持 Apple Silicon（M 系列芯片），不支持 Intel Mac。
- 下载后双击解压 → 把 `ShortestPath IDE.app` 拖进「应用程序」→ 首次打开若被 Gatekeeper 拦截（「已损坏，无法打开」/「无法验证开发者」），执行：

```bash
xattr -c "/Applications/ShortestPath IDE.app"
```

- 完整图文步骤与常见问题见 [macOS 安装指南（简体中文）](https://github.com/KevinHuangIsLearning/shortestpath-ide/blob/main/docs/macos-install.md) ／ [macOS Installation Guide (English)](https://github.com/KevinHuangIsLearning/shortestpath-ide/blob/main/docs/macos-install.en.md)。
- 编译器不在安装包里：首次运行向导会通过 Homebrew 安装 GCC 与 LLVM（clangd），依赖网络。

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
| Linux                                    | —                                                            | No release packages available yet; please build from source.

### macOS (Apple Silicon)

- **Only one file is released: [\`ShortestPath-IDE-macos-arm64.zip\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip)**; it supports Apple Silicon (M-series chips) only and does not support Intel Macs.
- After downloading, double-click to unzip → drag `ShortestPath IDE.app` into the "Applications" folder → if Gatekeeper blocks the app upon first launch (e.g., "damaged and can't be opened" or "developer cannot be verified"), run this command:

```bash
xattr -c "/Applications/ShortestPath IDE.app"
```

- For full illustrated steps and FAQs, see the [macOS Installation Guide (Simplified Chinese)](https://github.com/KevinHuangIsLearning/shortestpath-ide/blob/main/docs/macos-install.md) / [macOS Installation Guide (English)](https://github.com/KevinHuangIsLearning/shortestpath-ide/blob/main/docs/macos-install.en.md).
- The compiler is not included in the installation package: the first-run wizard installs GCC and LLVM (clangd) via Homebrew, which requires an internet connection.
