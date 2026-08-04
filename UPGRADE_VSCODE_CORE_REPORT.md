# ShortestPath IDE 升级 VS Code 内核报告

> 初次调研：2026-07-18。策略修订：2026-07-26。当前证据来自原有 `./` 源码树的 1.130.0 就地升级结果。

## 结论

这不是一次只改版本号的升级，也不是下载一份新版 VS Code 后重新搭建 ShortestPath。正确方法是把原有 `./` 作为唯一产品源码树，固定一个官方 tag，对照上游变化逐项升级已有实现，并持续保留产品定制、既有删减和用户明确移除的功能。

1.130.0 已按此方式合入现有历史：官方 tag `1b6a188127e` 是升级合并提交 `d076fcfaa32` 的第二父提交，当前产品提交为 `3456c8cb6da`。仓库已不是浅克隆，`package.json` 和 extension API 均为 `1.130.0`。这次实践同时证明，升级验收必须覆盖负向需求：新版上游可能重新带回 Copilot、Chat、Agent、状态栏或标题栏入口，不能只检查编译成功。

升级难度仍为**中等偏高**：首次启动、OI 扩展和打包大多是可维护的产品层改动；工作台布局、标题栏、扩展管理和上游新增 AI 表面修改频繁，必须逐项人工适配并做真实开发版 UI 回归。

## 当前基线与先决条件

| 项目 | 当前观察 | 对升级的含义 |
| --- | --- | --- |
| 当前分支/提交 | `upgrade/vscode-1.130.0-in-place`，`3456c8cb6da` | 本次升级在原有源码树完成；后续升级继续从当前 ShortestPath 基线建分支。 |
| 内核版本 | `package.json` 与 `product.json` extension API 均为 `1.130.0` | 后续仍应选择明确的 VS Code stable tag/commit，不能只跟随浮动的 `upstream/main`。 |
| 上游 | `upstream=https://github.com/microsoft/vscode.git` | 可作为唯一内核来源；`origin` 继续承载 ShortestPath 改动。 |
| 历史完整性 | `git rev-parse --is-shallow-repository` 为 `false`；`git merge-base 1.130.0 HEAD` 为官方 tag 提交 | 1.130.0 起已经存在可追踪的上游父线，后续可以直接比较固定 tag。 |
| 工作方式 | 原有 `./` 目录内的专用升级分支 | 不创建新版源码副本或以官方 tag 为起点的产品工作树；用户未提交内容需原样保护。 |

后续升级建议先执行：

```bash
git status --short
git rev-parse --is-shallow-repository
git fetch upstream --tags
git merge-base HEAD <目标上游tag>
git log --oneline --decorate --max-count=1 <目标上游tag>
```

若未来目标 tag 与当前树意外没有共同祖先，应先停下来核对远端和 tag，不得改成“新上游基线 + 重新移植 ShortestPath”。只有在原有树内建立了可审查、可解释的基线关系后才能继续。

## 必须保留并迁移的定制面

### 1. 产品身份、发行与数据隔离（高优先级）

主要文件：`product.json`、根 `package.json`、`resources/linux/**`、`resources/server/**`、`resources/win32/**`、`build/win32/code.iss`。

需要核对并保持：`applicationName`、`dataFolderName`、macOS bundle identifier、Windows AppUserModelId、协议名、Linux 图标/包名、更新与问题反馈 URL、许可证链接和安装程序显示名。上游升级常新增 product 字段或调整默认值；应以新版上游的字段结构为准，再逐字段重新应用 ShortestPath 值，避免用旧整个文件覆盖新版。

### 2. 首次启动、预设和工具链（高优先级）

主要文件：`src/vs/code/electron-main/app.ts`、`resources/oi-defaults/first-run.html`、`resources/oi-defaults/first-run-preload.js`、`extensions/shortestpath.setup/**`。

这是“先于 workbench 打开”的独立 onboarding：创建窗口、IPC 通道、写入 `shortestpath.setup.pending/completed`、选工作目录、安装/检查 clangd 与编译器，并将设置交给 `shortestpath.setup` 扩展落地。Electron 的窗口安全、preload、IPC 和启动顺序在上游升级中都可能变更。

迁移时不要机械套用旧版 `app.ts`。应先在新版中找到对应启动生命周期、BrowserWindow 创建、CLI 参数与配置服务调用点，再以最小补丁接入。必须验证：取消、网络失败、重复启动、已完成首次配置、中文界面、macOS/Windows/Linux 三种预设，以及升级后老用户不会再次被强制引导。

### 3. OI 扩展、默认行为和第三方兼容（高优先级）

主要文件：`extensions/shortestpath.setup/**`、`extensions/danielpinto8zz6.c-cpp-compile-run/**`、`extensions/divyanshuagrawal.competitive-programming-helper/**`、`extensions/llvm-vs-code-extensions.vscode-clangd/package.json`。

还包括：`build/gulpfile.extensions.ts`、`build/lib/extensions.ts`、`build/npm/dirs.ts`、根 `package.json` 的 `compile-oi-extensions`。升级后须重新检查 VS Code extension API、激活事件、配置 schema、webview CSP/IPC、以及 CPH/clangd/Compile Run 的运行时兼容性。所有要随发行版携带的扩展，都必须同时满足“编译、npm 依赖安装、打包包含、运行时扫描到”四个条件。

### 4. 打包与 CI（高优先级）

主要文件：`build/gulpfile.vscode.ts`、`build/gulpfile.reh.ts`、`build/lib/electron.ts`、`.github/workflows/build-windows.yml`、`.github/workflows/release.yml`。

定制版额外复制 `resources/oi-defaults`、过滤不需要的扩展/Agent host、编译 OI 扩展，并产出 Windows 与 macOS 包。上游升级可能改变 Electron/Node 版本、原生模块 ABI、gulp target、构建缓存与 artifact 布局。

Windows 流程特别要保留并复核：`signtool.exe` 预检、两个“是否包含编译器”构建矩阵、将 `VSCode-win32-x64` 暂存到 `.build/artifacts` 后再上传、以及包内 `ShortestPath.exe` 和扩展入口文件检查。不要在本地编译未通过前重跑完整 GitHub Actions。

### 5. 本地化、扩展市场和分发裁剪（中高风险）

主要文件：`src/vs/base/node/nls.ts`、`src/vs/workbench/api/common/extHostLocalizationService.ts`、`build/lib/i18n.resources.json`、扩展管理相关 `src/vs/platform/extensionManagement/**` 与 workbench extensions 服务。

升级后先让上游 i18n 资源和 NLS 逻辑保持完整，再重新加入 `vs/workbench/contrib/shortestpath` 等自定义资源登记。开发模式中文、打包模式中文、内建扩展扫描与扩展市场可用性应分别验证。对 Copilot/Agent host 等裁剪应采用新版的正式扩展点或过滤链路，不能假定旧的 host/包路径仍存在。

### 6. 新标签页、侧边栏、标题栏与布局（最高冲突风险）

主要文件集中在：

- `src/vs/workbench/contrib/shortestpath/**`：ShortestPath 新标签页；
- `src/vs/workbench/browser/parts/{activitybar,sidebar,auxiliarybar,editor,titlebar}/**`；
- `src/vs/workbench/browser/{layout.ts,workbench.ts,workbench.contribution.ts}`；
- `src/vs/workbench/electron-browser/parts/titlebar/titlebarPart.ts`。

这些文件近期连续调整了活动栏位置、主侧边栏固定在左侧、辅助侧边栏关闭操作、标签栏与原生窗口控制区的留白、以及 New Tab 的启动/拆分语义。它们都是 VS Code 上游持续迭代的 UI 核心，升级时最容易出现“能编译但窗口控制按钮遮挡、拖动失效、侧栏无法恢复、New Tab 阻塞启动”等回归。

建议把此类改动进一步收敛为独立贡献或 CSS 覆盖；短期内则按功能块逐个移植，绝不整目录覆盖上游版本。每次移植后都要在 macOS 与 Windows 的不同 title bar 设置、窄窗口、侧边栏左右切换、辅助侧边栏、编辑器分屏下手工验收。

## 推荐升级流程

1. **冻结现有产品状态。** 在原有 `./` 中清点未提交内容、Git 删除、产品定制和明确禁用功能；从已确认的 ShortestPath 基线创建 `upgrade/vscode-<目标版本>` 分支。
2. **固定并比较上游。** 补全需要的 Git 对象，固定 stable tag，记录当前基线到目标 tag 的上游变化、Node/Electron 版本和 breaking changes。
3. **把上游引入现有树。** 在当前升级分支合并目标 tag；现有 ShortestPath 文件是升级对象，不切换到一份新版源码后重新移植。
4. **逐层解决并适配。** 基础构建 → 产品元数据 → 打包资源/扩展清单 → `shortestpath.setup` → onboarding 主进程 → 本地化/扩展分发 → New Tab/布局/标题栏。每个冲突都同时阅读现有实现和新版实现。
5. **检查负向需求。** 每层都确认被主动删除或隐藏的 Copilot、Chat、Agent、顶栏入口和无关内建扩展没有被上游恢复。
6. **每块做最小验证。** 先静态检查和 `npm run compile`，再构建目标平台包；新增或更新自动化测试，最后必须用仓库开发版 `workbench-dev.html` 做桌面 smoke test。
7. **独立审查与循环修复。** 开发完成后由只读审查线程从需求完整性、逻辑正确性、边界情况、代码质量、测试覆盖和实际运行结果六方面复核；主线程修复后再次复验。
8. **分平台发布验证与回滚。** macOS arm64 与 Windows x64 都使用隔离 user-data 启动；升级使用独立 PR 和 beta tag，不覆盖当前稳定 tag。

## 可执行检查清单

### 合并前

- [ ] 已在原有 `./` 目录确认所有未提交内容和删除项的归属，并从现有产品基线创建升级分支。
- [ ] `git merge-base <目标上游tag> HEAD` 有结果，且已记录 fork base。
- [ ] 已固定目标 VS Code tag/commit，不使用未审计的浮动 `upstream/main`。
- [ ] 已比较新版 `package.json`、`product.json` schema、Electron/Node、`yarn.lock`/`package-lock.json` 与原生依赖变化。
- [ ] 已列出并确认所有必须携带的 OI 扩展、工具链压缩包及其许可证。
- [ ] 已列出不得恢复的扩展、Chat/Agent/Copilot UI、状态栏和顶栏入口。

### 编译和打包

- [ ] `npm ci` 成功；若上游改变了包管理或 Node 要求，按其新要求更新 CI 与开发文档。
- [ ] `npm run compile` 成功。
- [ ] `npm run compile-oi-extensions` 成功。
- [ ] `npm run gulp vscode-darwin-arm64-min` 成功，并检查 app 内含 onboarding 资源与 OI 扩展。
- [ ] `npm run gulp vscode-win32-x64-min` 成功，并检查 `ShortestPath.exe`、扩展入口和编译器矩阵产物。

### 运行时回归

- [ ] `./scripts/code.sh --user-data-dir /private/tmp/shortestpath-upgrade-smoke` 能启动开发实例，页面 URL 指向当前仓库的 `workbench-dev.html`。
- [ ] 首次启动：推荐/自定义、语言、工作目录、下载进度、取消与失败重试正确；完成后不再重复出现。
- [ ] clangd、g++、CPH、Compile Run、代码模板、自动格式化、工具链诊断均可用。
- [ ] 中文开发模式与打包模式均正确显示。
- [ ] 新标签页可打开、关闭和分屏；主侧边栏不可被意外移走；辅助侧边栏和标题栏控制区在 macOS/Windows 均正常。
- [ ] Copilot、Chat、Agent、状态栏和额外顶栏入口没有重新出现；相关自动更新列表为空。
- [ ] 更新已有用户数据目录时，旧设置、工作区信任和扩展扫描不会造成崩溃或重复安装。

## 建议的提交切分

为降低审查和回滚成本，建议不要把升级做成一个巨型提交：

1. `chore(upstream): update VS Code core to <version>`：记录上游引入与构建适配。
2. `fix(product): preserve ShortestPath branding and distribution defaults`。
3. `feat(setup): adapt onboarding and OI toolchain flow`。
4. `build: preserve OI extensions and platform packaging`。
5. `fix(workbench): adapt ShortestPath tab and layout behavior`。
6. `test: add upgrade smoke coverage` 与发布说明。

这样当上游再次升级时，可以在同一产品历史中清楚比较每层变化，也更容易定位是哪一层引入了回归；这些提交不是为了在一份全新的上游源码上重新拼装产品。

## 本次调研证据

- 当前 `HEAD` 为 `3456c8cb6da`，根 `package.json` 与 `product.json` extension API 都显示 `1.130.0`。
- 本地仓库不是 shallow；`git merge-base 1.130.0 HEAD` 返回 `1b6a188127e`。
- 合并提交 `d076fcfaa32` 的两个父提交分别是现有 ShortestPath 基线桥接提交 `c15425711b1e` 和官方 1.130.0 tag `1b6a188127e`，证明新版是被引入原有产品历史，而不是用新源码替换产品。
- 1.130.0 升级后的编译、OI 扩展、precommit、Chromium 回归、macOS 打包和仓库开发版 UI smoke test 均已执行；审查发现的 Copilot Chat 自动更新与 API 版本问题已在 `3456c8cb6da` 修复并复验。
