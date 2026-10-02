# 用线上 SPOJ 测试本地 IDE

从当前源码启动带有新版 OJ 与 CPH 扩展的桌面 IDE：

```bash
cd ~/workspace/shortestpath-ide
bash scripts/open-online.sh
```

脚本编译内置 OI 扩展（包括环境向导、OJ 与 CPH），然后打开 `~/workspace/shortestpath-practice`。用户配置保存在仓库 `tmp/shortestpath-online`，题目源码和缓存保存在做题目录。重启使用同一命令；也可把做题目录作为第一个参数传入。该入口使用生产 Origin 允许列表，不启用 E2E HTTP 驱动。

当前本机已有 Electron 和核心开发构建。首次准备其他机器时需按仓库构建指南安装依赖并运行 `npm run transpile-client-localized` 生成支持中英文的核心开发产物。该命令及 watch 入口会先复制 Codicon 图标字体。若已有旧 out 目录但缺少字体或本地化索引，启动脚本自动重新生成开发产物；脚本不下载完整依赖。

进入 IDE 后，如目录处于 Restricted Mode，检查并信任自己的做题目录以启用 OJ 扩展。首次导入可能要求选择代码语言。此启动入口首次默认中文，并尊重通过“配置显示语言”保存的偏好。普通 `transpile-client` 和增量 watch 入口生成英文开发产物；运行后需重新执行 `npm run transpile-client-localized` 恢复本地化产物。完整语言切换使用命令面板的 Configure Display Language（配置显示语言），并重启 IDE。

在 Zen 等已登录浏览器中打开 `https://shortestpath.cn` 的具体题目页，进入做题状态，然后点击标题附近的 IDE 入口（可显示为蓝色 IDE 图标，按钮名称为“在 ShortestPath IDE 中打开”）。IDE 已运行时网页直接连接本机 `127.0.0.1:21474`，不用重新登录 IDE。浏览器页必须保持打开；刷新或换题后再次点击入口。

导入成功时 IDE 显示题面和源码文件，CPH 显示可执行的普通样例。编辑源码后在 IDE 主动提交，网页使用当前登录身份提交到线上，并把结果同步回 IDE。线上提交、开题、提示揭示、题解和付费辅助任务会产生真实账号记录，测试时按需要选择这些操作。交互、grader、SPJ 等特殊题使用正式服务器评测，本地显示公开评测说明。

若显示未连接，先确认具体题目页已进入做题状态、IDE 信任了目录，并确认没有另一个 IDE 占用桥接端口。直接打开 `.build/electron/ShortestPath IDE.app` 不等同于上述源码启动入口；使用脚本确保加载当前开发代码。

若资源管理器、搜索、设置等图标整片空白，而 CPH 图片仍能显示，检查 Codicon 字体构建产物。`npm run transpile-client-localized` 会补齐字体和本地化索引；完成后重新启动 IDE。


## 本地化构建说明

2026-10-02 排查的中英文混用有三处来源：普通 esbuild 转译没有生成数字化的本地化调用和索引；开发启动默认英文；首启向导新增中文文案缺少英文映射。现在在线启动缺少本地化产物时自动运行 localized 构建，Node 启动也会加载开发消息表。`build-fast` 在本地化产物上改动核心文件时会完整重建索引，避免个别文件回退英文。翻译缓存依据开发消息和内置中文包内容更新，避免旧索引误配。

已在真实桌面分别验证中文、独立英文配置的菜单和首启向导；中文新增侧栏和新建标签页按钮标签也补入内置中文包。题目原文、源码、安装工具原始输出和外部扩展自行提供的内容保留其原有语言。本轮并非完整重译所有上游新功能，缺少中文资源的上游消息仍会回退英文。

验证：Setup 39 项、OJ 76 项、构建/映射/增量策略 27 项和缓存失效检查通过；核心 `typecheck-client`、shell 语法及 `git diff --check` 通过。另行尝试的 `build/tsconfig.json` 全量类型检查仍受仓库原有缺失 `policyDto.ts`、rspack 和 component-explorer 依赖阻挡，未修改这些无关文件。
