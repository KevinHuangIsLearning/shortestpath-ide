# ShortestPath IDE

[English](README.md)

ShortestPath IDE 是一个面向算法竞赛（OI / ICPC）的开源集成开发环境，基于 Code - OSS 构建。它提供更适合 C++ 竞赛开发的默认配置、题目工作流与工具链配置体验。

## 功能

- 面向竞赛的 C++ 编辑器、编译与运行默认配置
- 内置 Competitive Programming Helper（CPH）及常用在线评测（OJ）链接映射
- clangd、格式化、代码片段及工具链诊断支持
- Windows、macOS 与 Linux 的工具链配置流程
- 内置简体中文语言包和竞赛相关扩展

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

## 使用的开源项目与许可证

ShortestPath IDE 的仓库许可证为 [GPL-3.0-or-later](LICENSE)。本项目包含、修改或捆绑的开源组件仍适用其各自许可证；以下列表用于标注主要来源，并不是完整的第三方依赖清单。

| 项目 | 用途 | 许可证 |
| --- | --- | --- |
| [Code - OSS](https://github.com/microsoft/vscode) | 上游编辑器代码库 | [MIT](licenses/MIT-VSCode.txt) |
| [Competitive Programming Helper](https://github.com/agrawal-d/competitive-programming-helper) | 竞赛题目与测试工作流 | GPL-3.0-or-later |
| [C/C++ Compile Run](https://github.com/danielpinto8zz6/c-cpp-compile-run) | C/C++ 编译运行支持 | GPL-3.0 |
| [vscode-clangd](https://github.com/clangd/vscode-clangd) | clangd 编辑器集成 | MIT |
| [CodeSnap](https://github.com/kufii/CodeSnap) | 代码截图 | MIT |
| [Better C++ Syntax](https://github.com/jeff-hykin/better-cpp-syntax) | C++ 语法高亮 | MIT |
| [VS Code 简体中文语言包](https://github.com/Microsoft/vscode-loc) | 简体中文界面本地化 | MIT |

完整的第三方版权和许可证声明见 [ThirdPartyNotices.txt](ThirdPartyNotices.txt)，并请同时保留各扩展目录中附带的许可证文件。本说明不构成法律意见。

## 反馈与贡献

请通过 [Issues](https://github.com/KevinHuangIsLearning/shortestpath-ide/issues) 报告问题或提出建议。提交改动前，请运行与改动相符的编译或测试命令。
