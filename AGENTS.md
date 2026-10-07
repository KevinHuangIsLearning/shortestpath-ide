# 工作约定

- 优先读代码、静态检查和针对性测试；非必要不使用 computer use 或自行做前端验证，定位 bug 或用户明确要求时例外。
- 复杂任务先规划，完成后由独立只读 agent 审查，修复后复查。
- 无法从代码或证据确认、且影响实现的需求或外部行为，先问用户。

## 编译与发布

- 验证按 `.github/copilot-instructions.md`；优先已有 watch 诊断和针对性测试，勿用 `npm run compile` 仅做类型检查。
- 打包前运行 `npm run compile-oi-extensions`；平台构建及产物要求以 `.github/workflows/release.yml` 为准。
- 正式版标签 `Release-v*`，预发布 `Beta-v*`；正式版须同步 `product.json` 的 `shortestPathVersion`、`latest.json` 的版本与下载链接，更新 `docs/release-notes.md`。

## 上游同步红线

- 不发布 Copilot/Chat/Agent 扩展，但必须保留 Chat、MCP、Interactive、ChatSessions、agentHost 的服务注册及 sessions 颜色/尺寸 token；只移除 UI 入口。缺失服务会杀死整个扩展宿主。
- 保留 `chat.shared.contribution`，勿重复注册其 LanguageModel 服务。`src/vs/sessions/` 是独立入口。
- 静态核对 desktop 入口的服务注册与所有 `mainThread*.ts` 类的注入；扫描全部 decorator，不能只看首个构造函数。

## 本地化

- 覆盖全部 IDE 自有静态/动态文本及原生 UI；保留外部题目内容、元数据和代码，必要时用 `data-i18n-ignore`。
- Webview 满足 CSP；MutationObserver 写入前比较值，保持幂等。覆盖动态文本、CSP 和外部内容边界的回归测试。
- 本地化改动运行 OJ/Setup 测试、`npm run typecheck-client` 和 `git diff --check`。
