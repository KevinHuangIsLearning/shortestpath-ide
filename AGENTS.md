# 工作约定

- 优先读代码、静态检查和针对性测试；非必要不使用 computer use 或自行做前端验证，定位 bug 或用户明确要求时例外。
- 复杂任务先规划，完成后由独立只读 agent 审查，修复后复查。
- 提交前由独立只读 agent 审查最终暂存差异，核对提交范围、代码、测试、版权与检查配置；修复发现的问题并复查后再提交。
- 无法从代码或证据确认、且影响实现的需求或外部行为，先问用户。

## 版权与文件头

- 新增的 ShortestPath 自有代码使用仓库已有的 `ShortestPath IDE contributors` GPL-3.0-or-later 文件头，禁止将自写代码署名为 Microsoft。
- 修改上游或第三方文件时保留原始版权与许可证声明；不得随意替换作者、许可证或拼接不相符的声明。需要添加修改声明时，遵循仓库已有格式。
- 写入文件头前核对文件来源、`LICENSE` 以及 `build/hygiene.ts`、`eslint.config.js` 中的约定；提交前检查新增文件头，禁止编造版权归属。

## 编译与发布

- 验证按 `.github/copilot-instructions.md`；优先已有 watch 诊断和针对性测试，勿用 `npm run compile` 仅做类型检查。
- 打包前运行 `npm run compile-oi-extensions`；平台构建及产物要求以 `.github/workflows/release.yml` 为准。
- 正式版标签 `Release-v*`，预发布 `Beta-v*`；正式版须同步 `product.json` 的 `shortestPathVersion`、`latest.json` 的版本与下载链接，更新 `docs/release-notes.md`。
- 发布说明按用户可见变化描述：写清受影响的场景、原有问题和更新后的行为，使用用户能理解的简洁语言；不罗列内部实现、服务注册、代码路径或测试过程，除非这些信息影响用户操作。
- 此约定覆盖 `docs/release-notes.md`、`release-notes/*.md`、`latest.json` 的 `releaseNote` 和 GitHub Release 正文；中英文内容保持一致。写法参考 [describe releases by user-visible changes](https://github.com/KevinHuangIsLearning/shortestpath-ide/commit/0e46212f893366cb9d7395a4706b6e0cf074f34b)，例如“修复启动后题目样例无法加载、本地评测无法使用的问题”。

## 上游同步红线

- 不发布 Copilot/Chat/Agent 扩展，但必须保留 Chat、MCP、Interactive、ChatSessions、agentHost 的服务注册及 sessions 颜色/尺寸 token；只移除 UI 入口。缺失服务会杀死整个扩展宿主。
- 保留 `chat.shared.contribution`，勿重复注册其 LanguageModel 服务。`src/vs/sessions/` 是独立入口。
- 静态核对 desktop 入口的服务注册与所有 `mainThread*.ts` 类的注入；扫描全部 decorator，不能只看首个构造函数。

## 本地化

- 覆盖全部 IDE 自有静态/动态文本及原生 UI；保留外部题目内容、元数据和代码，必要时用 `data-i18n-ignore`。
- Webview 满足 CSP；MutationObserver 写入前比较值，保持幂等。覆盖动态文本、CSP 和外部内容边界的回归测试。
- 本地化改动运行 OJ/Setup 测试、`npm run typecheck-client` 和 `git diff --check`。
