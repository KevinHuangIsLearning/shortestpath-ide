# ShortestPath IDE：升级 VS Code 内核指南

在现有 ShortestPath 源码树中升级，保留已有产品定制和未提交的用户改动。目标使用 Microsoft VS Code 的固定 stable tag，不追踪浮动的 `main`。

## 1. 获取新 Code

确认工作区状态，获取上游 tag，并在现有源码树的升级分支合并目标版本：

```bash
git status --short
git fetch upstream --tags
git switch -c upgrade/vscode-<target-tag>
git merge --no-ff <target-tag>
```

已有升级分支时直接在该分支继续。若历史没有共同祖先，先查明原因；不要强行合并或另建一份上游源码。

## 2. 解决冲突

逐文件解决冲突：采用新版 API，保留 ShortestPath 的产品身份、OI 扩展、首次启动流程、界面布局和已有功能裁剪。不要整份覆盖定制文件，也不要恢复已删除的 Copilot、Chat、Agent 产品入口。

完成后检查冲突标记和改动范围：

```bash
git status --short
git diff --check
```

## 3. 更新内置语言包

从 [微软 Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=MS-CEINTL.vscode-language-pack-zh-hans) 获取最新简体中文语言包，更新 `extensions/MS-CEINTL.vscode-language-pack-zh-hans/` 中的官方清单与翻译文件，保留 ShortestPath 自有扩展的翻译。以微软提供的最新版本为准。

## 4. 运行编译

依赖缺失时先运行 `npm ci`，然后执行：

```bash
npm run compile
```

## 5. 合并到 main

编译成功后，提交升级改动，并将升级分支合并到 `main`：

```bash
git switch main
git merge --no-ff upgrade/vscode-<target-tag>
```

合并完成后，本指南的内核升级流程完成。
