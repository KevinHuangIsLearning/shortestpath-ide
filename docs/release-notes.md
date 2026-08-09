# ShortestPath IDE 下载说明 / Download Guide

> 不知道怎么选？看这张表就够了。不知道怎么选时，**默认选第一行**。
>
> Can't decide? Just read the table. **When in doubt, pick the first row for your platform.**

The English version follows the Chinese version.

## 简体中文 / Chinese

### 一图速览

> 点一下表格里的文件名，就是直接下载。

| 你的平台 | 下载这个 | 说明 |
| --- | --- | --- |
| Windows x64（大多数人） | [`ShortestPath-IDE-Windows-Include-Compiler-x64-User-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Include-Compiler-x64-User-Setup.exe) | 当前用户安装，**内置 GCC 编译器**，无需管理员权限，装完即用、离线可用 |
| Windows x64，升级已有版本 | [`...-Exclude-Compiler-x64-User-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64-User-Setup.exe) · [`...-x64-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64-Setup.exe) · [`...-x64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64.zip)（看你上次的安装方式） | 编译器已装好，更新选 Exclude 即可，体积更小、下载更快 |
| Windows x64，要绿色版 | [`ShortestPath-IDE-Windows-Include-Compiler-x64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Include-Compiler-x64.zip) | 解压即用，**内置 GCC**，不写注册表 |
| Windows x64，系统级安装 | [`ShortestPath-IDE-Windows-Include-Compiler-x64-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Include-Compiler-x64-Setup.exe) | 系统级安装（需管理员），**内置 GCC**，给这台机器所有用户用 |
| Windows x64，已有自己的编译器 | [`...-Exclude-Compiler-x64-User-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64-User-Setup.exe) · [`...-x64-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64-Setup.exe) · [`...-x64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64.zip)（看你上次的安装方式） | 体积更小，首次运行向导时联网下载 GCC |
| macOS（Apple Silicon，M 系列）| [`ShortestPath-IDE-macos-arm64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip) | 唯一选择；解压后拖入「应用程序」，首次打开被拦截请看下方指南 |
| Linux | — | 暂不提供发布包，请自行从源码构建 |

### Windows（x64）

所有 Windows 包都只支持 **64 位**。

#### 推荐：内置编译器的版本（Include-Compiler）

`-Include-Compiler-` 的版本把 **WinLibs GCC（g++）** 直接打包进了安装包，首次启动的开箱向导会把它解压到 IDE 数据目录，**不需要联网下载、不需要自己装编译器、不需要改 PATH**，装完就能打比赛。**绝大多数人应该选这类。**

三种形态选一个即可（内容完全一样，只是安装方式不同）：

| 文件 | 适合谁 |
| --- | --- |
| [`ShortestPath-IDE-Windows-Include-Compiler-x64-User-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Include-Compiler-x64-User-Setup.exe) | **默认选这个。** 当前用户安装，无需管理员权限，适合绝大多数人；只装给自己，不动系统设置。 |
| [`ShortestPath-IDE-Windows-Include-Compiler-x64-Setup.exe`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Include-Compiler-x64-Setup.exe) | 系统级安装（要管理员权限），给这台机器上的所有用户安装，会写入「开始菜单 / 右键菜单」。多人共用一台电脑时才需要。 |
| [`ShortestPath-IDE-Windows-Include-Compiler-x64.zip`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Include-Compiler-x64.zip) | 绿色便携版，解压后直接运行 `ShortestPath.exe`，不写注册表 |

#### 可选：不内置编译器的版本（Exclude-Compiler）

`-Exclude-Compiler-` 的版本体积更小，首次运行的开箱向导会**联网下载** WinLibs GCC（可选 GitHub 或国内镜像源）。适合**已经装好 g++ / MinGW** 或**网速受限、想省流量**的用户。

**升级已有版本的用户也建议选 Exclude-Compiler**：你的编译器已经配置在 IDE 数据目录里，更新时不需要再下一遍内置编译器，包更小、下载更快。

文件命名规律同上：`...-Exclude-Compiler-x64-{Setup,User-Setup,zip}`。全部文件见 [GitHub Releases](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases)。

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

**Q: Include-Compiler 和 Exclude-Compiler 有什么差别？**
A: 只有一点：编译器（g++/WinLibs）是否打包在安装包里。Include 版本开箱即用、离线可用；Exclude 版本更小，首次运行需要联网下载编译器。功能上没有任何区别。

**Q: Setup.exe 和 User-Setup.exe 呢？**
A: 安装方式不同：User-Setup 只装当前用户、**无需管理员权限，推荐默认选它**；Setup 是系统级安装（需要管理员，所有用户可用），只在多人共用一台电脑时选。

**Q: 为什么我的 Mac 提示 app 已损坏？**
A: 文件没坏，是 macOS Gatekeeper 在拦截未签名软件，按上面 `xattr -c` 命令解决。

**Q: 下载哪个都行吗？**
A: 同平台同变体内，zip 和 exe 内容一致。Windows 没有特殊偏好时认准 `-Include-Compiler-` 前缀，安装方式默认选 User-Setup 即可。

## English / 英语

> Can't decide? Just read the table. **When in doubt, pick the first row for your platform.**

### Quick Overview

> Click a file name in the table to download it directly.

| Your Platform                            | Download This                                                | Notes                                                        |
| :--------------------------------------- | :----------------------------------------------------------- | :----------------------------------------------------------- |
| Windows x64 (Most users)                 | [\`ShortestPath-IDE-Windows-Include-Compiler-x64-User-Setup.exe\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Include-Compiler-x64-User-Setup.exe) | Per-user installation; **includes GCC compiler**; no admin rights needed; ready to use immediately; works offline. |
| Windows x64 (Upgrading existing version) | [\`...-Exclude-Compiler-x64-User-Setup.exe\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64-User-Setup.exe) · [\`...-x64-Setup.exe\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64-Setup.exe) · [\`...-x64.zip\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64.zip) (Choose based on your previous installation method) | Compiler is already installed; choose "Exclude" for updates; smaller size and faster download. |
| Windows x64 (Portable version)           | [\`ShortestPath-IDE-Windows-Include-Compiler-x64.zip\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Include-Compiler-x64.zip) | Extract and run; **includes GCC**; does not modify the Windows Registry. |
| Windows x64 (System-wide)                | [\`ShortestPath-IDE-Windows-Include-Compiler-x64-Setup.exe\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Include-Compiler-x64-Setup.exe) | System-wide installation (requires administrator privileges); **includes GCC**; for all users on the machine. |
| Windows x64 (Already have a compiler)    | [\`...-Exclude-Compiler-x64-User-Setup.exe\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64-User-Setup.exe) · [\`...-x64-Setup.exe\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64-Setup.exe) · [\`...-x64.zip\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Exclude-Compiler-x64.zip) (Choose based on your previous installation method) | Smaller download size; downloads GCC via the internet during the initial setup wizard. |
| macOS (Apple Silicon / M-series)         | [\`ShortestPath-IDE-macos-arm64.zip\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-macos-arm64.zip) | The only option; extract and drag to "Applications"; see the guide below if blocked upon first launch. |
| Linux                                    | —                                                            | No release packages available yet; please build from source. |

## Windows (x64)

All Windows packages support **64-bit** systems only.

#### Recommended: Version with Built-in Compiler (Include-Compiler)

The `-Include-Compiler-` version bundles **WinLibs GCC (g++)** directly into the installer. Upon the first launch, the setup wizard extracts it to the IDE data directory. **No internet download, manual compiler installation, or PATH modification is required**—you can start coding for competitions immediately after installation. **This is the recommended choice for the vast majority of users.**

Choose one of the three formats (the content is identical; only the installation method differs):

| File                                                         | Best For                                                     |
| :----------------------------------------------------------- | :----------------------------------------------------------- |
| [\`ShortestPath-IDE-Windows-Include-Compiler-x64-User-Setup.exe\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Include-Compiler-x64-User-Setup.exe) | **Default choice.** Installs only for the current user account; no administrator privileges required; suitable for most users. |
| [\`ShortestPath-IDE-Windows-Include-Compiler-x64-Setup.exe\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Include-Compiler-x64-Setup.exe) | System-wide installation (requires administrator privileges); installs for all users on the machine and adds entries to the Start Menu and context menus. Only needed for shared machines. |
| [\`ShortestPath-IDE-Windows-Include-Compiler-x64.zip\`](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases/latest/download/ShortestPath-IDE-Windows-Include-Compiler-x64.zip) | Portable version; simply extract and run `ShortestPath.exe`. Does not modify the Windows Registry. |

#### Optional: Version without Built-in Compiler (Exclude-Compiler)

The `-Exclude-Compiler-` version has a smaller file size. Upon the first launch, the setup wizard **downloads** WinLibs GCC via the internet (options include GitHub or domestic mirrors). This is suitable for users who **already have g++ / MinGW installed** or those with **limited internet speed/data usage**.

**Users upgrading an existing version are also advised to choose the Exclude-Compiler version**: Since your compiler is already configured in the IDE data directory, you won't need to download the built-in compiler again during the update, resulting in a smaller package and faster download.

File naming follows the same pattern: `...-Exclude-Compiler-x64-{Setup,User-Setup,zip}`. See [GitHub Releases](https://github.com/KevinHuangIsLearning/shortestpath-ide/releases) for all files.

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
A: There is only one difference: whether the compiler (g++/WinLibs) is bundled within the installation package. The "Include" version is ready to use out-of-the-box and works offline; the "Exclude" version is smaller but requires an internet connection to download the compiler upon first launch. There is no difference in functionality.

**Q: What about Setup.exe and User-Setup.exe?**
A: The installation method differs: "User-Setup" installs only for the current user and **requires no administrator privileges — the recommended default**; "Setup" performs a system-wide installation (requires administrator privileges; available to all users), only needed for shared machines.

**Q: Why does my Mac say the app is damaged?**
A: The file isn't actually damaged; macOS Gatekeeper is blocking unsigned software. Resolve this by running the `xattr -c` command mentioned above.

**Q: Does it matter which one I download?**
A: Within the same platform and variant, the contents of the zip and exe files are identical. On Windows, unless you have a specific preference, choose the `-Include-Compiler-` version and default to User-Setup for installation.
