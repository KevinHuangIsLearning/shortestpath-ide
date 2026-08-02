# ShortestPath IDE

[简体中文](README_cn.md)

ShortestPath IDE is an open-source integrated development environment for competitive programming (OI / ICPC), built on Code - OSS. It provides C++-oriented defaults, problem-solving workflows, and toolchain configuration suited to contest development.

## Features

- Competitive-programming-focused C++ editor, build, and run defaults
- Bundled Competitive Programming Helper (CPH) and common online-judge mappings
- Built-in ShortestPath OJ integration for synchronizing problems, hints, submissions, and editorials with the ShortestPath website
- clangd, formatting, snippets, and toolchain diagnostics
- Toolchain setup flows for Windows, macOS, and Linux
- Bundled Simplified Chinese language pack and contest-oriented extensions

## ShortestPath OJ integration

ShortestPath IDE includes the **ShortestPath OJ integration** extension. On a supported problem page at [ShortestPath OJ](https://shortestpath.cn/), use the website's IDE-integration entry while the IDE is running. The browser and IDE then communicate only through a local connection (`127.0.0.1:21474`).

After the page is connected, the IDE opens the problem view beside your source file and keeps the following information synchronized with the website:

- statement, examples, problem timer, hints, and hint-answer access state;
- source-code submission, submission progress, and final verdicts;
- editorial access and hint likes; and
- the problem context needed to continue the workflow in CPH Plus.

The website remains the source of truth for permissions such as opening hint answers and editorials. If the view shows that it is disconnected, keep ShortestPath IDE open and trigger the website's integration entry again. The local bridge does not expose a network service outside the current machine; source code is sent only when you choose to submit it.

## Build from source

Run the following from this directory:

```bash
npm ci
npm run compile
./scripts/code.sh --locale zh-cn --user-data-dir ./tmp/shortestpath-dev
```

Build a macOS Apple Silicon package:

```bash
npm run compile-oi-extensions
npm run gulp vscode-darwin-arm64-min
```

Build a Windows x64 package:

```bash
npm run compile-oi-extensions
npm run gulp vscode-win32-x64-min
```

## Open-source projects and licenses

ShortestPath IDE is licensed under [GPL-3.0-or-later](LICENSE). Open-source components included, modified, or bundled by this project remain under their respective licenses. The table below identifies principal sources; it is not a complete third-party dependency inventory.

| Project | Purpose | License |
| --- | --- | --- |
| [Code - OSS](https://github.com/microsoft/vscode) | Upstream editor codebase | [MIT](licenses/MIT-VSCode.txt) |
| [Competitive Programming Helper Plus](https://github.com/KevinHuangIsLearning/competitive-programming-helper-plus) | Contest problem and testing workflow | GPL-3.0-or-later |
| [Error Lens](https://github.com/usernamehw/vscode-error-lens) | Inline diagnostic highlighting | MIT |
| [C/C++ Compile Run](https://github.com/danielpinto8zz6/c-cpp-compile-run) | C/C++ compile-and-run support | GPL-3.0 |
| [vscode-clangd](https://github.com/clangd/vscode-clangd) | clangd editor integration | MIT |
| [CodeSnap](https://github.com/kufii/CodeSnap) | Source-code screenshots | MIT |
| [Better C++ Syntax](https://github.com/jeff-hykin/better-cpp-syntax) | C++ syntax highlighting | MIT |
| [VS Code Simplified Chinese Language Pack](https://github.com/Microsoft/vscode-loc) | Simplified Chinese UI localization | MIT |

See [ThirdPartyNotices.txt](ThirdPartyNotices.txt) for full third-party copyright and license notices. Preserve the license files included with individual extensions as well. This notice is not legal advice.

## Feedback and contributions

Please use [Issues](https://github.com/KevinHuangIsLearning/shortestpath-ide/issues) to report bugs or suggest improvements. Before submitting changes, run the compilation or tests relevant to your change.
