# 工作约定

- 修改代码和文本文件时，优先使用内置编辑或补丁工具，让每处改动可直接审阅；不要用终端脚本替代常规编辑。终端用于搜索、编译和检查。
- 默认只做必要的编译和轻量静态检查；简单改动不反复跑测试，不扩大验证范围。
- 除非用户明确要求，不主动启动 GUI、隔离实例、computer use、浏览器自动化、截图或复杂的端到端验证。普通 UI 调整交给用户直接查看，不以自动化视觉验证作为完成条件。
- 影响实现的需求或外部行为无法确认时，先问用户。

## 版权与文件头

- 自有新代码使用仓库既有的 `ShortestPath IDE contributors` GPL-3.0-or-later 文件头，不得署名 Microsoft。
- 上游 / 第三方文件保留原版权和许可证；修改声明遵循既有格式，不得编造或混拼归属与许可。
- 写文件头前核对来源、`LICENSE`、`build/hygiene.ts` 和 `eslint.config.js`；提交前检查新增文件头。

## 编译与发布

- 每次修改代码后，必须完成对应编译并更新实际运行的产物；不编译就等于没有写，不能报告完成。仅修改源码、仅编译测试或仅通过类型检查均不算完成。
- 按改动范围编译：主程序更新 `out/` 中对应的 JavaScript、CSS 等资源；内置扩展运行其构建/打包命令，更新 `package.json.main` 指向的实际入口及配套资源。已有 watch 仅在确认已产出本次改动且无编译错误时可代替手动编译。
- 按 `.github/copilot-instructions.md` 验证，优先已有 watch 诊断和针对性测试；勿仅为类型检查运行 `npm run compile`。
- 打包前运行 `npm run compile-oi-extensions`；构建与产物遵循 `.github/workflows/release.yml`。
- 标签：正式版 `Release-v*`，预发布 `Beta-v*`。正式版同步 `product.json.shortestPathVersion`、`latest.json` 版本与下载链接及 `docs/release-notes.md`。
- 发布说明简述用户可见的场景、问题和变化，省略无关实现与测试细节；各入口及中英文内容一致。

## 上游同步红线

- 不发布 Copilot/Chat/Agent 扩展，仅移除 UI 入口；保留 Chat、MCP、Interactive、ChatSessions、agentHost 服务注册及 sessions 颜色/尺寸 token，避免扩展宿主崩溃。
- 保留 `chat.shared.contribution`，勿重复注册其 LanguageModel 服务；`src/vs/sessions/` 为独立入口。
- 核对 desktop 服务注册及所有 `mainThread*.ts` 类的注入，扫描全部 decorator，不限首个构造函数。

## 本地化

- 覆盖 IDE 自有静态/动态文本及原生 UI；保留外部题目、元数据和代码，必要时用 `data-i18n-ignore`。
- Webview 遵循 CSP；MutationObserver 写入前比较值以保持幂等；回归测试覆盖动态文本、CSP 和外部内容边界。
- 本地化改动运行 OJ/Setup 测试、`npm run typecheck-client` 和 `git diff --check`。
