# ShortestPath IDE 下载说明 / Download Guide

## 如果你网络不畅，请使用快速下载选项。

**下载、使用本软件即代表同意 GPL-3.0 license 协议**。

## v0.3.10 更新 / What's New

- 修复 Windows 启动时窗口控制按钮颜色解析失败导致的闪退。
- Windows 窗口控制按钮继续保持透明背景，并保留系统控制按钮。
- 此版本为普通更新，可按需升级。

- Fixed a Windows startup crash caused by the window controls overlay rejecting the configured color.
- Windows window controls keep a transparent background while retaining the system controls.
- This is an optional update.

> 不知道怎么选？看这张表就够了。不知道怎么选时，**默认选第一行**。
>
> Can't decide? Just read the table. **When in doubt, pick the first row for your platform.**

The English version follows the Chinese version.

## 简体中文 / Chinese

### 一图速览

> 点一下表格里的文件名，就是直接下载。

| 你的平台 | 下载这个 | 说明 |
| --- | --- | --- |
| Windows x64（大多数人） | [`ShortestPath-IDE-Windows-x64-User-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-User-Setup.exe) | 当前用户安装，**内置 MinGW Lite GCC**，无需管理员权限，装完即用、离线可用 |
| Windows x64，要 U 盘便携版（推荐） | [`ShortestPath-IDE-Windows-x64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64.zip) | 解压即用，**内置 MinGW Lite GCC**；设置、插件和工具链保存在安装目录的 `data` 中，可随 U 盘移动 |
| Windows x64，系统级安装 | [`ShortestPath-IDE-Windows-x64-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-Setup.exe) | 系统级安装（需管理员），**内置 MinGW Lite GCC**，给这台机器所有用户用 |
| macOS（Apple Silicon，M 系列）| [`ShortestPath-IDE-macos-arm64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip) 或快速下载 <https://www.icloud.com.cn/iclouddrive/08cF_59Sro2BVBxDWGAUj5UoA> | 唯一选择；解压后拖入「应用程序」，首次打开被拦截请看下方指南 |
| Linux | — | 暂不提供发布包，请自行从源码构建 |

### Windows（x64）

所有 Windows 包都只支持 **64 位**。

所有 Windows `.zip` 发布包现在都默认启用便携模式，并在程序根目录内携带 `data`；Setup/User-Setup 安装包不启用该模式。

#### 内置 MinGW Lite 编译器

现在所有 Windows 包都统一内置 **MinGW Lite GCC 15.2.0**。首次启动的开箱向导会把它解压到 IDE 数据目录，**不需要联网下载、不需要自己装编译器、不需要改 PATH**，装完就能打比赛。新工具链使用体积更小的 `mingw64-ucrt-15.2.0-r8.tar.zst`。

三种形态的核心程序相同，但数据位置和安装方式不同：

| 文件 | 适合谁 |
| --- | --- |
| [`ShortestPath-IDE-Windows-x64-User-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-User-Setup.exe) | **默认选这个。** 当前用户安装，无需管理员权限，适合绝大多数人；只装给自己，不动系统设置。 |
| [`ShortestPath-IDE-Windows-x64-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-Setup.exe) | 系统级安装（要管理员权限），给这台机器上的所有用户安装，会写入「开始菜单 / 右键菜单」。多人共用一台电脑时才需要。 |
| [`ShortestPath-IDE-Windows-x64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64.zip) | U 盘便携版，解压后直接运行 `ShortestPath.exe`。ZIP 默认包含 `data`，设置、插件、工作状态及 ShortestPath 工具链都保存在其中；U 盘盘符变化时会自动修复内置 GCC/clangd 路径。 |

#### 便携版数据与升级

- 请完整保留程序目录中的 `data` 文件夹；它就是便携版的用户数据。
- 升级时先完全退出 ShortestPath IDE，将新 ZIP 解压到新目录，再用旧版本的整个 `data` 替换新目录中的 `data`。
- 工作区代码若也需要随身携带，请将项目文件夹放在 U 盘上；它不属于 IDE 的 `data`。
- 登录令牌受 Windows 凭据保护，换到另一台电脑后，部分账号或扩展可能需要重新登录。
- 拔出或同步 U 盘前必须退出 IDE，避免正在写入的状态数据库损坏。

不再分发 `Include-Compiler` 与 `Exclude-Compiler` 两套 Windows 包；三种 Windows 形态统一使用同一套内置 MinGW Lite 编译器。升级已有版本时，仍可保留 `data` 目录中的现有工具链，向导会检测并跳过重复解压。

### 安装注意

- 如果 Windows SmartScreen 提示「已保护你的电脑」，点「更多信息」→「仍要运行」。
- 安装包或 zip 里的程序未签名（开源项目，未购买代码签名证书），属正常现象。

---

### macOS（Apple Silicon）

- **只发布 [`ShortestPath-IDE-macos-arm64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip) 这一个文件**，仅支持 Apple Silicon（M 系列芯片），不支持 Intel Mac。
- 下载后双击解压 → 把 `ShortestPath IDE.app` 拖进「应用程序」→ 首次打开若被 Gatekeeper 拦截（「已损坏，无法打开」/「无法验证开发者」），执行：

```bash
xattr -c "/Applications/ShortestPath IDE.app"
```

- 完整图文步骤与常见问题见 [macOS 安装指南（简体中文）](https://github.com/KevinHuangIsLearning/shortestpath-ide/blob/main/docs/macos-install.md) ／ [macOS Installation Guide (English)](https://github.com/KevinHuangIsLearning/shortestpath-ide/blob/main/docs/macos-install.en.md)。
- 编译器不在安装包里：首次运行向导会通过 Homebrew 安装 GCC 与 LLVM（clangd），依赖网络。

### Linux

暂不提供现成的发布包，请从源码自行构建（见仓库 README）。

### 常见问题 / FAQ

**Q: Windows 现在有 Include-Compiler 和 Exclude-Compiler 两种包吗？**
A: 没有。Windows 包已统一内置体积更小的 MinGW Lite GCC，按安装方式选择 User-Setup、Setup 或 ZIP 即可。

**Q: Setup.exe 和 User-Setup.exe 呢？**
A: 安装方式不同：User-Setup 只装当前用户、**无需管理员权限，推荐默认选它**；Setup 是系统级安装（需要管理员，所有用户可用），只在多人共用一台电脑时选。

**Q: 为什么我的 Mac 提示 app 已损坏？**
A: 文件没坏，是 macOS Gatekeeper 在拦截未签名软件，按上面 `xattr -c` 命令解决。

**Q: 下载哪个都行吗？**
A: 核心功能一致，但数据位置不同：Setup/User-Setup 使用 Windows 用户目录，ZIP 默认使用自身的 `data` 目录并适合 U 盘携带。没有便携需求时，默认选择 `ShortestPath-IDE-Windows-x64-User-Setup.exe`。

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
| Linux                                    | —                                                            | No release packages available yet; please build from source. |

## Windows (x64)

All Windows packages support **64-bit** systems only.

All Windows `.zip` releases now enable portable mode by default and include a `data` directory next to the executable. Setup and User-Setup installers do not enable portable mode.

#### Built-in MinGW Lite compiler

All Windows packages now bundle **MinGW Lite GCC 15.2.0**. Upon the first launch, the setup wizard extracts it to the IDE data directory. **No internet download, manual compiler installation, or PATH modification is required**—you can start coding for competitions immediately after installation. The bundled archive is the smaller `mingw64-ucrt-15.2.0-r8.tar.zst`.

The three formats contain the same core application, but use different installation and data locations:

| File                                                         | Best For                                                     |
| :----------------------------------------------------------- | :----------------------------------------------------------- |
| [\`ShortestPath-IDE-Windows-x64-User-Setup.exe\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-User-Setup.exe) | **Default choice.** Installs only for the current user account; no administrator privileges required; suitable for most users. |
| [\`ShortestPath-IDE-Windows-x64-Setup.exe\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64-Setup.exe) | System-wide installation (requires administrator privileges); installs for all users on the machine and adds entries to the Start Menu and context menus. Only needed for shared machines. |
| [\`ShortestPath-IDE-Windows-x64.zip\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-x64.zip) | USB portable version; simply extract and run `ShortestPath.exe`. The ZIP includes `data` by default, which stores settings, extensions, session state, and the ShortestPath toolchain. Managed GCC/clangd paths are repaired automatically when the USB drive letter changes. |

#### Portable Data and Updates

- Keep the entire `data` directory next to `ShortestPath.exe`; it contains the portable user data.
- To update, fully quit ShortestPath IDE, extract the new ZIP into a new directory, then replace its `data` directory with the complete `data` directory from the old version.
- Put project folders on the USB drive too if source files must travel with the IDE; workspaces are not stored inside IDE `data`.
- Windows protects sign-in secrets with OS credentials, so some accounts or extensions might require signing in again on another computer.
- Quit the IDE before ejecting or synchronizing the drive to avoid corrupting state databases that are still being written.

Windows no longer publishes separate `Include-Compiler` and `Exclude-Compiler` packages. All three Windows formats use the same bundled MinGW Lite compiler. When upgrading an existing version, you can keep the existing toolchain in the `data` directory; the setup wizard detects it and skips extraction.

### Installation Notes

- If Windows SmartScreen displays a "Windows protected your PC" warning, click "More info" → "Run anyway".
- The programs within the installer or zip file are unsigned (this is normal for open-source projects that do not purchase code-signing certificates).

---

### macOS (Apple Silicon)

- **Only one file is released: [\`ShortestPath-IDE-macos-arm64.zip\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip)**; it supports Apple Silicon (M-series chips) only and does not support Intel Macs.
- After downloading, double-click to unzip → drag `ShortestPath IDE.app` into the "Applications" folder → if Gatekeeper blocks the app upon first launch (e.g., "damaged and can't be opened" or "developer cannot be verified"), run this command:

```bash
xattr -c "/Applications/ShortestPath IDE.app"
```

- For full illustrated steps and FAQs, see the [macOS Installation Guide (Simplified Chinese)](https://github.com/KevinHuangIsLearning/shortestpath-ide/blob/main/docs/macos-install.md) / [macOS Installation Guide (English)](https://github.com/KevinHuangIsLearning/shortestpath-ide/blob/main/docs/macos-install.en.md).
- The compiler is not included in the installation package: the first-run wizard installs GCC and LLVM (clangd) via Homebrew, which requires an internet connection.

### Linux

No pre-built release packages are currently available; please build from source (see the repository README).

### FAQ

**Q: What is the difference between "Include-Compiler" and "Exclude-Compiler"?**
A: Windows no longer has two compiler variants. Every Windows package includes the smaller MinGW Lite GCC; choose User-Setup, Setup, or ZIP based on the desired installation and data location.

**Q: What about Setup.exe and User-Setup.exe?**
A: The installation method differs: "User-Setup" installs only for the current user and **requires no administrator privileges — the recommended default**; "Setup" performs a system-wide installation (requires administrator privileges; available to all users), only needed for shared machines.

**Q: Why does my Mac say the app is damaged?**
A: The file isn't actually damaged; macOS Gatekeeper is blocking unsigned software. Resolve this by running the `xattr -c` command mentioned above.

**Q: Does it matter which one I download?**
A: The core features are the same, but data locations differ: Setup/User-Setup use the Windows user profile, while ZIP uses its adjacent `data` directory and is intended for USB portability. Without a portability requirement, choose `ShortestPath-IDE-Windows-x64-User-Setup.exe` by default.
