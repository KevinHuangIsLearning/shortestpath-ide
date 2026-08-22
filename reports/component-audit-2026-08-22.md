# ShortestPath IDE 组件冗余审计（2026-08-22）

## 范围与结论

本报告只做静态审计，基于当前 `main`（`9b0def128e7`，VS Code 1.133.0）和一份历史 macOS 包 `ShortestPath-IDE-1.130.0-darwin-arm64.zip`。历史包不能用于声明当前 0.3.11 的精确体积；下方 `out/` 数字只用于排序候选项。

目前最有价值的下一轮精简不是再删除 `extensions/copilot` 或 AI npm 包：它们已经不随产品打包。真正仍随核心输出存在的是 Chat/Agent/MCP 的 workbench 前端代码，以及可选的语言语法扩展。

## 已确认已排除，不应重复删除

- `extensions/copilot` 已在 `build/lib/extensions.ts` 的 OI 分发排除表和本地扩展排除表中排除。
- 根依赖中的 `@github/copilot*`、`@vscode/copilot-api`、`@anthropic-ai/*`、`@huggingface/*`、`@microsoft/mxc-sdk`、`onnxruntime-*` 和 Foundry 的预编译本机载荷，已由 `build/gulpfile.vscode.ts` 的打包过滤器排除。
- 因此，这些目录/依赖会占用开发 checkout 和编译时间，但不等同于发布包冗余。贸然删除它们会破坏与上游同步或核心编译。

## 优先级 A：产品明确不提供的 AI/Agent 前端

| 候选 | 当前直接输出大小 | 证据 | 建议 | 风险 |
| --- | ---: | --- | --- | --- |
| Chat / Agent sessions | 51 MiB | `workbench.common.main.ts` 仍导入 `contrib/chat`、Agent Host、chat views、chat input window、chat sessions、chat context；产品注释已说明不随产品提供 Copilot/Chat 扩展。 | 设计一份 `ShortestPath` 专用 workbench 入口/打包过滤策略，逐步取消这些贡献注册；保留被任务、编辑器或扩展 API 复用的服务。不要直接删整个目录。 | 高 |
| MCP | 3.1 MiB | `workbench.common.main.ts` 和 desktop 入口仍导入 MCP 贡献。 | 若产品不提供 AI、Agent 或 MCP 配置，和 Chat 一起移除入口。 | 中高 |
| Copilot Voice / Agents Voice | 2.6 MiB | common 和 desktop 入口均导入 `agentsVoice`。 | 可单独作为第一批 AI UI 清理目标；同时复核语音/听写是否有非 Agent 用途。 | 中 |
| BrowserView / Playwright 工作台服务 | 1.8 MiB | desktop 入口导入 Playwright workbench service，浏览器工具又服务于 Chat Agent。 | 先确认 ShortestPath OJ 的内置浏览器不依赖它；若不依赖，可与 Chat 工具一起排除。 | 中高 |
| Inline Chat、欢迎页 Agent Sessions、Remote Coding Agents | 0.5 MiB、0.17 MiB、0.01 MiB | 都仍有顶层 workbench 入口。 | 应随 Chat/Agent 清理批次移除，收益较小但可消除残留入口。 | 中 |

### 这批的正确实施方式

1. 先用产品级 feature flag 或入口排除使界面和命令不可达，而不是物理删除上游目录。
2. 按依赖关系裁减 `workbench.common.main.ts`、`workbench.desktop.main.ts`、Chat/MCP/Voice 的电子端入口及注册项。
3. 重跑完整编译，并在隔离 profile 中检查命令面板、状态栏、欢迎页、编辑器右键和 OJ 内置浏览器。
4. 若稳定，再评估是否值得维护一个构建时的 `out` 过滤规则；这才可能获得接近上述输出目录量级的包体收益。

已有一次同类清理仅取消了 Electron 端 Agent Host 的六项贡献注册，说明可以按入口逐步推进；当前移除的 Copilot 状态栏项也是同一类安全的 UI 级清理。

## 优先级 B：没有找到产品内使用证据的扩展

| 扩展 | checkout 目录大小 | 审计结果 | 建议 | 风险 |
| --- | ---: | --- | --- | --- |
| `tomoki1207.vscode-pdfviewer` | 125 MiB | 在产品配置、双语 README、ShortestPath setup/OJ 源码中未找到扩展 ID 或功能引用。 | 最适合作为“可选 PDF 预览”候选；先确认用户是否需要 IDE 内打开 PDF，再从 OI 分发扩展列表排除并同步许可/构建清单。 | 中 |
| `azemoh.one-monokai` | 24 KiB | 被欢迎页变体作为 `one-monokai` 默认主题引用。 | 不可直接删；若决定不要该主题，先替换默认主题和对应文案，再排除。 | 低 |

`CodeSnap` 不是冗余候选：README 明确把它作为内置竞赛扩展。`C/C++ Compile Run`、CPH、clangd、Error Lens 被 setup/诊断/简化设置直接读写或检测，不能单独删除。Markdown、Mermaid、Markdown Math 与 OJ/课程材料能力相关，也不建议按体积判断删除。

## 优先级 B：可选语言支持

下列语言扩展当前不在 `excludedForOIDistribution`，所以会进入 OI 分发。它们大多很小；删除的主要价值是缩小功能面和维护范围，不是显著减小安装包。

| 语言/扩展 | checkout 大小 | 推荐 | 说明 |
| --- | ---: | --- | --- |
| C/C++：`cpp` + Better C++ Syntax + clangd | 约 19 MiB（含第三方扩展目录） | 保留 | 是产品核心竞赛工作流；setup 直接配置/诊断 clangd 与 C++ 编译运行。 |
| JSON：`json` | 560 KiB | 保留 | 设置、任务、产品配置和 OJ 配置编辑都会受益；删除收益很小。 |
| Markdown：`markdown-basics` + Markdown Language Features | 约 290 MiB checkout，但包含开发依赖 | 保留 | README、题解、预览与 Mermaid/Math 依赖链相关；不能把 checkout 体积当发布体积。 |
| LaTeX：`latex` | 1.0 MiB | 已删除 | Markdown Math 保留；LaTeX 语法扩展已从仓库移除。 |
| Python：`python` | 148 KiB | 保留 | 保留 Python 高亮支持；不将其纳入本次语言精简范围。 |
| YAML：`yaml` | 172 KiB | 已删除 | 已从仓库移除。 |
| Shell：`shellscript` | 76 KiB | 已删除 | 已从仓库移除。 |
| Makefile：`make` | 28 KiB | 已删除 | 已从仓库移除。 |
| dotenv：`dotenv` | 24 KiB | 已删除 | 已从仓库移除。 |
| Prompt：`prompt-basics` | 28 KiB | 已删除 | 已从仓库移除。 |
| Log / Diff | 44 KiB | 可保留 | 通用编辑器基础能力，体积可忽略。 |

本次已从仓库删除 `latex`、`yaml`、`shellscript`、`make`、`dotenv`、`prompt-basics`；Python 语法高亮保持保留。

## 优先级 C：元数据和构建工作，而非发布包体

- `build/gulpfile.vscode.ts` 仍会写入 `copilotVersions`，也可能写入 `agentSdks`。在不提供 Copilot/Agent 的产品中，这些信息没有用户价值；可在 About 对话框改回只显示实际随产品发布的运行时版本，并跳过相应 metadata 写入。
- `build/npm/dirs.ts`、根 `package.json` 和 agent SDK 生产脚本仍保留 Copilot/Agent 依赖，目的是兼容上游编译。它们会增加开发安装和 CI 时间，但删除风险高，不建议纳入普通功能精简。
- 历史 macOS ZIP 含 4,254 个 `__MACOSX` 条目，未压缩约 0.6 MiB。它是可修的打包卫生问题，但不是组件裁减主战场；应在生成 ZIP 时禁用资源叉元数据。

## 建议的决策顺序

1. 确认是否彻底不支持 Chat、Agent、MCP、Copilot Voice 和内置 BrowserView；若是，先做 AI 入口裁减设计。
2. 确认是否需要 IDE 内 PDF 预览；若否，排除 `tomoki1207.vscode-pdfviewer`。
3. 确认语言白名单。建议默认白名单为 C/C++、JSON、Markdown、Diff、Log；LaTex 仅在课程/公式源文件编辑被正式支持时保留。
4. 每一批都构建一个目标平台包，比较解压体积和 ZIP 体积，并验证 setup、CPH、clangd、OJ、Markdown 预览和欢迎页。

## 未做的操作

本次没有删除任何扩展或核心模块，也没有改动构建配置。报告只基于静态入口、配置引用、打包过滤规则和目录大小；最终删减前仍应以新构建产物的文件清单和运行验证为准。
