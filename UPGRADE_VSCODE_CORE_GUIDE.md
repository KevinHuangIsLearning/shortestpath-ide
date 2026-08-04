# ShortestPath IDE：升级 VS Code 内核执行指南

本指南用于把 ShortestPath IDE 从当前发布基线升级到一个指定的 Microsoft VS Code tag。升级必须在现有 `./` 源码树中进行：以已有 ShortestPath 内容、删减和产品行为为主体，对照新版上游逐项适配。上游 tag 是比较与合并来源，不是另起一份新版源码重新搭建产品的起点。

配套背景与风险说明见 [UPGRADE_VSCODE_CORE_REPORT.md](UPGRADE_VSCODE_CORE_REPORT.md)。

## 0. 升级原则

1. 现有 `./` 是唯一产品源码树；不得下载一份新版源码、创建上游起点工作树后重新移植产品。
2. 固定目标 tag，不直接追踪浮动的 `upstream/main`。
3. 升级前清点现有定制、明确用户主动删除的功能，并把这些内容列为必须保留的负向需求。
4. 在现有树的升级分支中引入上游变化；冲突处理以保留现有产品意图并适配新版 API 为准。
5. 不用上游文件整份覆盖已有定制文件，尤其是 `product.json`、`app.ts`、workbench 布局和标题栏。
6. 每个阶段单独提交；每层都同时验证“新增内容正常”和“已删内容没有被上游恢复”。

下文用下列占位符：

```text
<target-tag>     Microsoft VS Code 的目标 stable tag，例如 1.xx.x
<current-tag>    当前 ShortestPath 内核对应的官方 tag
<upgrade-branch> upgrade/vscode-<target-tag>
<stable-tag>     升级前已验证可回退的 ShortestPath 发布 tag
```

## 1. 准备：保护现状、补全历史并确定目标

从现有仓库的 `./` 目录执行。先确认当前目录就是产品源码树，并记录已有状态。未提交内容属于正在开发的 ShortestPath 工作，不得通过切换目录或换一份源码来绕开；应明确提交、暂存或在升级期间原样保留。

```bash
git rev-parse --show-toplevel
git status --short
git diff --stat
git ls-files --deleted
git diff --name-status <current-tag>..HEAD
git rev-parse --is-shallow-repository
# 仅当上一条输出 true 时执行：
git fetch --unshallow upstream
git fetch upstream --tags
git tag --list '[0-9]*' --sort=-version:refname | head -20
git show --no-patch --decorate <target-tag>
git merge-base HEAD <target-tag>
```

验收条件：

- `git status --short` 中的改动和删除都已被理解，并有明确保留方式。
- 已列出产品身份、OI 扩展、首次启动、布局，以及 Copilot/Chat/Agent 等“不得恢复”的裁剪项。
- `<target-tag>` 对应预期的 stable 版本、提交和发布日期。
- 当前工作仍位于原有 `./`，没有新增源码副本或升级 worktree。

若 `git fetch --unshallow` 后仍没有共同祖先，停止常规 merge/rebase，走第 4 节的“无共同历史”流程。不要因此创建一份新版源码。

## 2. 在现有源码树创建升级分支

升级分支从当前确认过的 ShortestPath 基线创建，但仍在原有 `./` 目录工作。切换前先处理好当前未提交内容；不要使用 `git add -A`，也不要擅自清理用户文件。

```bash
git switch -c <upgrade-branch>
git status --short
git rev-parse --show-toplevel
```

以后所有源码升级命令均在这个现有目录和分支中运行。构建输出仍使用仓库既有位置；开发实例的 user-data 使用短的临时目录，与真实用户数据隔离。

## 3. 有共同历史时：引入新版上游

先记录两类差异，不直接修改代码：上游从当前基线到目标 tag 改了什么，以及 ShortestPath 在对应区域保留、修改或删除了什么。

```bash
git log --oneline HEAD..<target-tag>
git diff --stat HEAD...<target-tag>
git diff --name-status HEAD...<target-tag>
git log --first-parent --oneline --decorate -50
```

将目标版本合并到升级分支：

```bash
git merge --no-ff <target-tag> -m "chore(upstream): update VS Code core to <target-tag>"
```

发生冲突时，按第 5 节的分层顺序解决。不能简单选择 “ours” 或 “theirs”：逐个阅读现有实现和新版实现，保留 ShortestPath 行为、采用新版 API，并确认上游没有恢复用户已删除的产品入口。每解决一批文件先检查，再继续：

```bash
git status
git diff --check
git add <已解决的明确路径>
git commit
```

不要使用 `git add -A`。如发现引入方式错误，可用 `git merge --abort` 回到合并前；它只适用于尚未完成的本次 merge。

## 4. 无共同历史时：在现有树内建立可审查的上游关系

如果无法确定共同祖先，不要切到新版上游创建产品分支，也不要新建源码工作树。现有 ShortestPath 树仍是升级主体。先查明当前快照对应的官方版本；只有确认 `<current-tag>` 与当前源码确实对应并经过独立审查后，才允许在当前升级分支建立一次 bridge。该 bridge 只补充父线关系，树对象必须与 bridge 前的 ShortestPath `HEAD` 完全相同。

```bash
git show --no-patch <current-tag>
git diff --name-status <current-tag>..HEAD

# 仅用于首次修复“导入快照与官方 tag 无共同历史”的仓库。
# 当前目录必须仍是原有 ./，且当前分支必须是升级分支。
current_head=$(git rev-parse HEAD)
current_tree=$(git rev-parse HEAD^{tree})
bridge_commit=$(
	printf '%s\n\n%s\n' \
		"chore(upstream): record VS Code <current-tag> base" \
		"Keep the existing ShortestPath tree unchanged and record the verified upstream snapshot." |
		git commit-tree "$current_tree" -p "$current_head" -p <current-tag>
)
git merge --ff-only "$bridge_commit"

# bridge 验收：文件树不变，第一父提交是原 ShortestPath HEAD，
# 第二父提交是已核实的官方 tag。
test "$(git rev-parse HEAD^{tree})" = "$current_tree"
test "$(git rev-parse HEAD^1)" = "$current_head"
test "$(git rev-parse HEAD^2)" = "$(git rev-parse <current-tag>)"
git diff --exit-code "$current_head" HEAD
git merge-base --is-ancestor <current-tag> HEAD
```

bridge 必须独立提交并写明两个来源，不能用 `--allow-unrelated-histories` 直接制造一次无法审查的全树冲突。它是旧导入历史的一次性修复；当前历史已经包含官方父线时不得重复创建。验收全部通过后，仍按第 3 节从现有树合并目标 tag，并逐文件解决。若无法可靠确认旧快照的官方来源，应暂停升级并补证据，而不是改用“新版源码 + 重新移植”的方式继续。

## 5. 冲突处理顺序与每层验收

| 顺序 | 定制面 | 优先检查文件 | 完成本层的最低验收 |
| --- | --- | --- | --- |
| 1 | 现状清单与负向需求 | Git 删除记录、扩展目录、产品配置、UI 入口 | 明确哪些现有内容必须保留，哪些功能不得被上游恢复。 |
| 2 | 基础构建 | `package.json`、锁文件、`.nvmrc`、`build/lib/electron.ts` | 安装依赖并通过基础编译。 |
| 3 | 产品身份 | `product.json`、`resources/{linux,server,win32}`、`build/win32/code.iss` | app 名称、数据目录、图标/协议/安装程序标识仍是 ShortestPath。 |
| 4 | OI 发行内容 | `build/gulpfile.{extensions,vscode}.ts`、`build/lib/extensions.ts`、`build/npm/dirs.ts` | setup、CPH、clangd、Compile Run 被编译并被打进包。 |
| 5 | 首次启动/工具链 | `src/vs/code/electron-main/app.ts`、`resources/oi-defaults/**`、`extensions/shortestpath.setup/**` | 首次启动窗口、IPC、预设、工具链安装与已完成状态正常。 |
| 6 | 本地化/扩展策略 | `src/vs/base/node/nls.ts`、`build/lib/i18n.resources.json`、extension-management 文件 | 中文开发/打包模式和内建扩展扫描正常。 |
| 7 | Workbench UI 与裁剪 | `src/vs/workbench/contrib/shortestpath/**`、chat/agent、sidebar/activitybar/editor/titlebar 文件 | New Tab 与布局正常；Copilot/Chat/Agent 和额外顶栏入口没有被恢复。 |
| 8 | CI 与发布 | `.github/workflows/{build-windows,release}.yml` | 本地静态审查完成，Windows artifact 和 macOS 打包路径正确。 |

处理原则：以现有 ShortestPath 产品意图和删减边界为主体，逐项采用新版上游 API 与结构。不能确认用途的现有补丁不得擅自丢弃，应先追溯提交和运行行为，仍不明确时询问用户。特别是 UI 层，优先保留行为约束并适配新版实现，而不是复制任一侧的整份旧 CSS。

## 6. 本地验证命令

在现有 `./` 升级分支内，按照成本从低到高执行：

```bash
# 依赖与核心编译
npm ci
npm run compile

# OI 扩展
npm run compile-oi-extensions

# macOS 开发启动（使用独立数据目录）
./scripts/code.sh --user-data-dir /private/tmp/shortestpath-upgrade-smoke

# 平台包（按当前机器/CI 能力选择）
npm run gulp vscode-darwin-arm64-min
npm run gulp vscode-win32-x64-min
```

`npm run compile` 或扩展编译失败时，不要开始打包，更不要触发完整 GitHub Actions。先修正 TypeScript/API/打包清单问题。

### 手工 smoke checklist

- [ ] 使用空 user-data 启动：首次启动只出现 ShortestPath 引导，而非先出现 workbench。
- [ ] 推荐与自定义模式、平台预设、中文、工作目录选择、下载进度、取消/失败重试可用。
- [ ] 再次启动不会重复引导；使用旧用户目录升级也不崩溃。
- [ ] clangd、g++、CPH、Compile Run、代码模板、自动格式化、工具链诊断可用。
- [ ] New Tab 可关闭、可分屏且不阻塞启动。
- [ ] 主侧边栏、辅助侧边栏、活动栏和标题栏在窄窗口、不同 title bar 设置下可恢复且不遮挡窗口控制区。
- [ ] Copilot、Chat、Agent、状态栏或标题栏相关入口没有因上游合并重新出现。
- [ ] 打包产物内含 `resources/oi-defaults`、`shortestpath.setup` 及所需扩展入口。

## 7. CI 与发布验证

先审查 `.github/workflows/build-windows.yml` 和 `release.yml`，确认新版上游变更没有破坏：

- Node/Electron/原生依赖所需的 runner 与缓存键；
- `npm run compile-oi-extensions` 在打包前执行；
- Windows SDK 中的 `signtool.exe` 已发现并做预检；
- 构建输出从仓库外 `../VSCode-win32-x64` 暂存到 `.build/artifacts/VSCode-win32-x64` 后上传；
- Windows 的含/不含编译器矩阵、`ShortestPath.exe` 与扩展入口检查仍存在；
- macOS arm64 压缩包名称、包内资源和发布附件路径仍正确。

本地通过后，再用专门的 beta tag 触发发布验证。不要覆盖稳定 tag：

```bash
git tag Beta-v<ShortestPath版本>
git push origin <upgrade-branch> Beta-v<ShortestPath版本>
```

仅在下载并验证 beta 产物后，才创建正式 `Release-v<ShortestPath版本>` tag。

## 8. 建议提交结构与回滚

建议保留以下可审查边界：

```text
chore(upstream): update VS Code core to <target-tag>
fix(product): preserve ShortestPath branding and distribution defaults
build: preserve OI extensions and platform packaging
feat(setup): adapt onboarding and OI toolchain flow
fix(workbench): adapt ShortestPath tab and layout behavior
test: add upgrade smoke coverage
```

出现问题时，稳定版仍停留在升级前记录的 `<stable-tag>`；停止推广 beta，而不是在发布分支上临时混入无关修复。对一个已合并的主题提交使用普通 revert；对尚未合并的升级分支，直接修正该分支后重新出 beta。

## 9. 完成定义

只有同时满足下列条件，内核升级才算完成：

- 目标 VS Code tag、fork base、升级提交和 ShortestPath 发布 tag 都有记录；
- 升级在原有 `./` 源码树完成，没有遗留新版源码副本或额外升级 worktree；
- macOS arm64、Windows x64 的目标产物均能构建并启动；
- 首次启动、OI 工具链、核心 OI 扩展、中文、本地化、New Tab 和布局 smoke test 全部通过；
- 用户主动删除的 Copilot/Chat/Agent 和额外顶栏入口没有被恢复；
- CI artifact、签名/暂存与 release 附件已验证；
- 产品身份、许可证和第三方 notices 随包正确交付；
- 有经验证的 beta，且稳定版回退路径明确。
