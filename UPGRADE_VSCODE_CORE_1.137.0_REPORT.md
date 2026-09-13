# ShortestPath IDE VS Code 1.137.0 内核升级报告

日期：2026-09-13

## 结果

- 在原有 ShortestPath 源码树中，将 VS Code 内核从现有基线合并升级至官方 `1.137.0` tag。
- 官方 tag 提交：`645f29cc3176500b4b5762ba887cf2a7f0ffdf2c`。
- 保留 ShortestPath 产品身份、更新配置、OI 扩展、首次启动流程和既有 Workbench 定制。
- Sessions、Agent、Chat、Copilot 不再注册为 ShortestPath 产品功能：移除了 Workbench/独立窗口入口、AgentHost 进程和远端桥接入口、Copilot 内建扩展，以及桌面和远端包中的 AI 运行时载荷。
- 1.137 的扩展 API 与通用编辑器模块仍依赖部分 Chat/Agent/Sessions 协议和类型源码；这些兼容实现保留在源码树中，但没有产品入口，也不打入对应 AI 运行时依赖。

## 验证

- `npm run typecheck-client`：通过。
- `npm run compile`：通过，核心源码与参与根编译的扩展均为 0 errors。
- `npm run compile-oi-extensions`：通过。
- `git diff --check`：通过。
- 产品字段确认：`version=1.137.0`、`nameShort=ShortestPath`、`nameLong=ShortestPath IDE`、`applicationName=shortestpath`、`dataFolderName=.shortestpath-ide`、`urlProtocol=shortestpath`。
- 负向字段确认：没有 `defaultChatAgent`、`sessionsWindowAllowedExtensions`、`agentsTelemetryAppName`、`copilotVersions` 或 `dictationRuntime` 产品配置。

## 环境说明

- 常规 `npm ci` 在本机编译 `@vscode/sqlite3` 时因缺少 Xcode Command Line Tools 失败；随后使用 `npm ci --ignore-scripts` 安装编译所需依赖，并生成 1.137 所需 Electron 类型后完成上述编译验证。
- 按用户要求，没有启动隔离开发实例、没有执行运行时 smoke test、没有构建平台安装包；运行时验收由用户完成。
- 本次只合并到本地 `main`，未推送远端、未创建 tag、未触发 CI 或发布。
