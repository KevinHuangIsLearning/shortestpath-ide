# ShortestPath IDE

[English](README.md)

ShortestPath IDE 是一个面向算法竞赛（OI / ICPC）的开源集成开发环境，基于 Code - OSS 构建。它围绕「装好就能打比赛」设计：首次启动引导你配置工具链，日常用 CPH 导入题目、一键测试、直接提交，配合 ShortestPath OJ 互通同步比赛状态。

## 功能

### 开箱即用的竞赛环境

- **一键环境配置向导**：首次启动引导你在 Windows / macOS / Linux 上安装并配置编译工具链，随时可以重新运行
- **工具链检测与修复**：自动检测当前可用的编译器，一键重新检测、一键修复，内置诊断面板，环境问题不再靠猜
- **OI 工作区初始化**：打开文件夹时自动生成 `.clangd`（C++23）与 `.clang-format`，无需手动配工程

### C++ 竞赛工作流

- **CPH Plus（内置）**：配合浏览器端 Competitive Companion，在题目页一键导入题目，自动下载样例、一键编译运行测试，完成后可直接提交到 OJ
- **多 OJ 自动归档**：Codeforces / AtCoder / 洛谷 / 牛客 / CSES / VJudge 等按 `{OJ}/{比赛编号}/{题号}` 模板自动创建目录与命名，支持按 OJ 单独定制模板
- **clangd 智能补全与诊断**：配合 Error Lens 行内错误高亮，问题直接标在代码上
- **自动格式化**：默认保存 / 粘贴即格式化（clang-format），可一键配置
- **可配置的 C++ 代码片段**：开局少敲几行模板代码

### 内置浏览器 Dark Reader

内置浏览器的 HTTP / HTTPS 网页默认通过 Dark Reader 跟随 IDE 主题。点击浏览器工具栏的 **Dark Reader**，可以选择「跟随 IDE 主题」「开启」「关闭」，也可以单独禁用当前站点。设置立即生效，重启后保留。

默认开启网页原生深色主题检测，检测到后保留网站自己的外观。可在 Dark Reader 菜单或通过 `workbench.browser.darkReader.detectDarkTheme` 开关此功能。

对应设置为 `workbench.browser.darkReader.mode`（`auto`、`on`、`off`）和 `workbench.browser.darkReader.excludedHosts`（精确主机名，子域名独立匹配）。Dark Reader 官方 API 引擎随 IDE 本地捆绑。

### AtCoder 与 Codeforces 浏览增强

内置浏览器捆绑了 [OJBetter](https://github.com/beijixiaohu/OJBetter) 的 **Atcoder Better! 1.25.1** 和 **Codeforces Better! 1.87.1**。在内置浏览器中打开两站，即可通过页面的 Better 设置面板使用网站本地化、题面翻译、主题和编辑器选项。两项集成默认开启；可通过 IDE 设置 `shortestpath.ojbetter.atcoder`、`shortestpath.ojbetter.codeforces` 分别关闭，之后刷新已有页面。

脚本与运行资源随 IDE 本地打包和更新；翻译、在线编译及 LSP 仍依赖配置的外部服务。详见 [OJBetter 集成说明](extensions/shortestpath.ojbetter/README.md)。

### ShortestPath OJ 互通

ShortestPath IDE 内置 **ShortestPath OJ 集成**扩展。保持 IDE 运行后，在 [ShortestPath OJ](https://shortestpath.cn/) 的受支持题目页面使用网站提供的 IDE 互通入口，即可与本机 IDE 建立连接；通信只经过本机 `127.0.0.1:21474`。

连接成功后，IDE 会在源码旁打开题面视图，并与网站同步：

- 题面、样例、比赛计时、提示及提示答案的访问状态；
- 源码提交、评测进度和最终结果；
- 解题报告访问与提示点赞；以及
- 继续使用 CPH Plus 工作流所需的题目上下文（题目级对拍等）。

提示答案和解题报告等权限始终以网站状态为准。若题面显示未连接，请保持 ShortestPath IDE 运行并再次使用网站的互通入口。本地桥接不会向本机以外提供网络服务；只有你主动提交时才会发送源码。

### 面向竞赛的贴心细节

- **编译产物自动清理**：默认 60 秒后自动删除编译生成的临时可执行文件，目录不堆积垃圾（可配置开关与延迟）
- **配置文件默认隐藏**：资源管理器默认隐藏 `.cph` 等配置文件，需要时一键「显示全部文件」
- **竞赛友好的默认设置**：保存即格式化、内联提示、自动保存、隐藏状态栏与命令中心、平滑滚动，屏幕留给代码
- **内置简体中文语言包**，以及 Error Lens、Better C++ Syntax、CodeSnap 等常用竞赛扩展

## 安装 macOS 版

ShortestPath IDE 在 macOS 上以 zip 压缩包分发。**第一次用 Mac、或遇到「已损坏」「无法验证开发者」提示**，请阅读 [macOS 安装指南](docs/macos-install.md)，里面有分步操作和常见报错对照表。

## 从源码构建

在本目录执行：

```bash
npm ci
npm run compile
./scripts/code.sh --locale zh-cn --user-data-dir ./tmp/shortestpath-dev
```

构建 macOS Apple Silicon 安装包：

```bash
npm run compile-oi-extensions
npm run gulp vscode-darwin-arm64-min
```

构建 Windows x64 安装包：

```bash
npm run compile-oi-extensions
npm run gulp vscode-win32-x64-min
```

构建 Linux x64 安装包：

```bash
npm run compile-oi-extensions
npm run gulp vscode-linux-x64-min
```

## 使用的开源项目与许可证

ShortestPath IDE 的仓库许可证为 [GPL-3.0-or-later](LICENSE)。本项目包含、修改或捆绑的开源组件仍适用其各自许可证；以下列表用于标注主要来源，并不是完整的第三方依赖清单。

| 项目 | 用途 | 许可证 |
| --- | --- | --- |
| [Code - OSS](https://github.com/microsoft/vscode) | 上游编辑器代码库 | [MIT](licenses/MIT-VSCode.txt) |
| [Dark Reader](https://github.com/darkreader/darkreader) | 内置浏览器网页深色主题 | MIT |
| [Competitive Programming Helper Plus](https://github.com/KevinHuangIsLearning/competitive-programming-helper-plus) | 竞赛题目与测试工作流 | GPL-3.0-or-later |
| [OJBetter](https://github.com/beijixiaohu/OJBetter) | AtCoder 与 Codeforces 内置浏览器增强 | [GPL-3.0](extensions/shortestpath.ojbetter/resources/vendor/OJBetter-LICENSE) |
| [Error Lens](https://github.com/usernamehw/vscode-error-lens) | 行内诊断信息高亮 | MIT |
| [C/C++ Compile Run](https://github.com/danielpinto8zz6/c-cpp-compile-run) | C/C++ 编译运行支持 | GPL-3.0 |
| [vscode-clangd](https://github.com/clangd/vscode-clangd) | clangd 编辑器集成 | MIT |
| [CodeSnap](https://github.com/kufii/CodeSnap) | 代码截图 | MIT |
| [Better C++ Syntax](https://github.com/jeff-hykin/better-cpp-syntax) | C++ 语法高亮 | MIT |
| [PDF Viewer](https://github.com/mathematic-inc/vscode-pdf) | PDF 题目查看 | Apache-2.0 |
| [Flintmark](https://github.com/quboliu/flintmark) | 所见即所得 Markdown 编辑器 | MIT |
| [VS Code 简体中文语言包](https://github.com/Microsoft/vscode-loc) | 简体中文界面本地化 | MIT |

完整的第三方版权和许可证声明见 [ThirdPartyNotices.txt](ThirdPartyNotices.txt)，并请同时保留各扩展目录中附带的许可证文件。本说明不构成法律意见。

## 反馈与贡献

请通过 [Issues](https://github.com/KevinHuangIsLearning/shortestpath-ide/issues) 报告问题或提出建议。提交改动前，请运行与改动相符的编译或测试命令。

使用本软件即代表你同意本软件的相关条款。开 Issue 前，请先重启应用、搜索已有问题并查阅文档。
