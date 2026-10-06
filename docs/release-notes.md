# ShortestPath IDE 下载说明 / Download Guide

**下载、使用本软件即代表同意 GPL-3.0 license 协议**。

## v0.4.1 更新 / What's New

- 修复 Judger 在 Windows 高 DPI 环境下整个面板字号偏大的问题：按钮、标题和样例统一跟随 IDE 界面字号，不再随编辑器字号一起放大。

### English

- Fixed oversized Judger panel text and controls on Windows high-DPI displays. Buttons, titles, and samples now follow the IDE UI font size instead of the editor font size.

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
