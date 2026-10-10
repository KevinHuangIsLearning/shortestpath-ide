# ShortestPath IDE

[简体中文](README_cn.md)

ShortestPath IDE is an open-source integrated development environment for competitive programming (OI / ICPC), built on Code - OSS. It is designed to be usable for a contest from the very first launch: a first-run wizard configures your toolchain, CPH imports problems, runs one-click tests, and submits directly, and the ShortestPath OJ integration keeps your contest state in sync.

## Features

### Contest-ready environment, out of the box

- **One-click setup wizard**: guides you through installing and configuring the C++ toolchain on Windows, macOS, and Linux on first launch, and can be rerun any time
- **Toolchain detection and repair**: automatically detects available compilers, re-detects or repairs on demand, and ships a diagnostics panel — no more guessing why a build fails
- **OI workspace initialization**: creates `.clangd` (C++23) and `.clang-format` automatically when you open a folder

### C++ contest workflow

- **CPH Plus (bundled)**: with the Competitive Companion browser extension, import a problem in one click from its page, auto-download samples, compile and run tests with a single command, then submit back to the judge
- **Multi-OJ auto-filing**: problems from Codeforces, AtCoder, Luogu, NowCoder, CSES, VJudge, and more are archived with configurable `{OJ}/{contest}/{problem}` templates and automatic directory creation, with per-OJ overrides
- **clangd completion and diagnostics**: paired with Error Lens for inline error highlighting right on the code
- **Auto-formatting**: format on save and on paste by default (clang-format), configurable in one click
- **Configurable C++ snippets**: less boilerplate before the first keystroke of a solution

### Dark Reader in the integrated browser

HTTP and HTTPS pages in the integrated browser use Dark Reader, following the IDE theme by default. Open **Dark Reader** from the browser toolbar to choose **Follow IDE Theme**, **On**, or **Off**, or disable it for the current site. Changes apply immediately and are saved across restarts.

Automatic detection of a site’s built-in dark theme is enabled by default, preserving the site’s own appearance. Toggle it in the Dark Reader menu or with `workbench.browser.darkReader.detectDarkTheme`.

The settings are `workbench.browser.darkReader.mode` (`auto`, `on`, or `off`) and `workbench.browser.darkReader.excludedHosts` (exact hostnames; subdomains are independent). The official Dark Reader API engine is bundled locally.

### AtCoder and Codeforces browser enhancements

The integrated browser bundles **Atcoder Better! 1.25.1** and **Codeforces Better! 1.87.1** from [OJBetter](https://github.com/beijixiaohu/OJBetter). Open either website in the integrated browser to use its Better settings panel for website localization, statement translation, themes, and editor options. Both integrations are enabled by default; use `shortestpath.ojbetter.atcoder` or `shortestpath.ojbetter.codeforces` under **Settings → Tools → Integrated Browser** to disable one, then refresh existing pages.

Scripts and runtime resources are bundled locally and update with the IDE. Translation, online compilation, and LSP still depend on their configured external services. See the [OJBetter integration README](extensions/shortestpath.ojbetter/README.md) for details.

### ShortestPath OJ integration

ShortestPath IDE includes the **ShortestPath OJ integration** extension. On a supported problem page at [ShortestPath OJ](https://shortestpath.cn/), use the website's IDE-integration entry while the IDE is running. The browser and IDE then communicate only through a local connection (`127.0.0.1:21474`).

After the page is connected, the IDE opens the problem view beside your source file and keeps the following information synchronized with the website:

- statement, examples, problem timer, hints, and hint-answer access state;
- source-code submission, submission progress, and final verdicts;
- editorial access and hint likes; and
- submission diagnostics, AI correction reports, and the problem context needed for CPH Plus.

The website remains the source of truth for permissions such as opening hint answers and editorials. If the view shows that it is disconnected, keep ShortestPath IDE open and trigger the website's integration entry again. The local bridge does not expose a network service outside the current machine; source code is sent only when you choose to submit it.

Protocol v2 supports training, standalone upsolving and contest targets, public interaction/grader information, OI scores and hidden results, and recovery of submissions and paid tasks after an uncertain response. Standard token-based samples run in CPH; special judging modes show their public testing instructions and use the server for formal judging. The website still owns authentication and business permissions.

The shared bridge contract and HTTP DTOs are generated in the SPOJ repository and vendored under `extensions/shortestpath.oj/src/generated/`. Update them with SPOJ's `scripts/sync-ide-contract.mjs --ide-root ../shortestpath-ide`; do not edit generated files manually. Design and acceptance records are in SPOJ's `docs/shortestpath-ide-protocol-v2-design-2026-10-02.md` and `docs/shortestpath-ide-e2e-2026-10-02.md`. See [native E2E driver instructions](test/ide-bridge/README.md) for local integration testing. See [online testing instructions](docs/online-testing.md) to use an already logged-in browser against the production website.

### Details that matter in a contest

- **Automatic build-artifact cleanup**: compiled executables are removed 60 seconds after the run by default, keeping your workspace clean (configurable delay and on/off)
- **Config files hidden by default**: `.cph` and other config files stay out of the Explorer until you toggle “Show All Files”
- **Contest-friendly defaults**: format on save, inlay hints, autosave, hidden status bar and command center, smooth scrolling — more screen space for code
- **Bundled Simplified Chinese language pack**, plus Error Lens, Better C++ Syntax, and CodeSnap

## Install on macOS

ShortestPath IDE is distributed on macOS as a zip archive. If you are new to macOS or hit the “damaged” / “unidentified developer” warning on first launch, see the [macOS installation guide (简体中文)](docs/macos-install.md) for step-by-step instructions and a troubleshooting table.

## Build from source

Run the following from this directory:

```bash
npm ci
npm run transpile-client-localized
npm run compile-oi-extensions
./scripts/code.sh --locale zh-cn --user-data-dir ./tmp/shortestpath-dev
```

The localized development build supports Simplified Chinese and English. Use **Configure Display Language** in the command palette and restart to switch languages. Plain `transpile-client` and incremental watch outputs use English; rebuild with `transpile-client-localized` for localized UI.

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

Build a Linux x64 package:

```bash
npm run compile-oi-extensions
npm run gulp vscode-linux-x64-min
```

## Open-source projects and licenses

ShortestPath IDE is licensed under [GPL-3.0-or-later](LICENSE). Open-source components included, modified, or bundled by this project remain under their respective licenses. The table below identifies principal sources; it is not a complete third-party dependency inventory.

| Project | Purpose | License |
| --- | --- | --- |
| [Code - OSS](https://github.com/microsoft/vscode) | Upstream editor codebase | [MIT](licenses/MIT-VSCode.txt) |
| [Dark Reader](https://github.com/darkreader/darkreader) | Dark themes for integrated browser pages | MIT |
| [Competitive Programming Helper Plus](https://github.com/KevinHuangIsLearning/competitive-programming-helper-plus) | Contest problem and testing workflow | GPL-3.0-or-later |
| [OJBetter](https://github.com/beijixiaohu/OJBetter) | AtCoder and Codeforces integrated-browser enhancements | [GPL-3.0](extensions/shortestpath.ojbetter/resources/vendor/OJBetter-LICENSE) |
| [Error Lens](https://github.com/usernamehw/vscode-error-lens) | Inline diagnostic highlighting | MIT |
| [C/C++ Compile Run](https://github.com/danielpinto8zz6/c-cpp-compile-run) | C/C++ compile-and-run support | GPL-3.0 |
| [vscode-clangd](https://github.com/clangd/vscode-clangd) | clangd editor integration | MIT |
| [CodeSnap](https://github.com/kufii/CodeSnap) | Source-code screenshots | MIT |
| [Better C++ Syntax](https://github.com/jeff-hykin/better-cpp-syntax) | C++ syntax highlighting | MIT |
| [PDF Viewer](https://github.com/mathematic-inc/vscode-pdf) | PDF problem viewer | Apache-2.0 |
| [Flintmark](https://github.com/quboliu/flintmark) | Live-preview Markdown editor | MIT |
| [VS Code Simplified Chinese Language Pack](https://github.com/Microsoft/vscode-loc) | Simplified Chinese UI localization | MIT |

See [ThirdPartyNotices.txt](ThirdPartyNotices.txt) for full third-party copyright and license notices. Preserve the license files included with individual extensions as well. This notice is not legal advice.

## Feedback and contributions

Please use [Issues](https://github.com/KevinHuangIsLearning/shortestpath-ide/issues) to report bugs or suggest improvements. Before submitting changes, run the compilation or tests relevant to your change.

By using this software you agree to its terms. Before opening an issue, please restart the application, search existing issues, and review the documentation.
