完成之后移动到 Solved，然后写上日期，附上报告的超链接。

# Todos


- [ ] 【暂时搁置】添加做题 Dashboard，显示做题热力图，展示出做的题目的 source oj, from，**make a plan before do it, and you should let me comfirm. 如果有不清楚的细节，向我询问**。方案：[Dashboard 实施方案（待确认）](reports/dashboard-plan-2026-10-04.md)。已确认按 AC 日期统计、部分 AC 单列，同时展示原 OJ、导入平台和比赛/题单。确认方案后实施。

# Solved

## 20261006

- [x] 更改内置浏览器“添加题目”的样式，导入题目不应该发送通知，这会导致浏览器“因通知而暂停”。只有在有对应 Parser 的时候展示按钮，也允许用户在没有对应 Parser 的情况下手动选择 Parser，支持搜索。先出方案。 已加入拖动与位置边界限制；折叠为单个半透明按钮，导入后及自动打开题目网页时自动收起。

实现与验证记录：[内置浏览器导入控件改造报告](reports/browser-import-controls-2026-10-06.md)。

- [x] 默认第一次打开不是中文，而是英文。已改为跟随用户语言设置，未设置时跟随系统首选语言。

实现与验证记录：[首次启动语言修复报告](reports/first-launch-language-2026-10-06.md)。

## 20261004

- [x] 有时候会在当前目录（不是项目根目录）下新建一个 .shortestpath 文件夹，应该在根目录新建。
- [x] 在 Finder 中展示的版本号是 VSCode 的版本号。
- [x] 在内置浏览器中添加和 Competitive Companion 功能相同的插件，用于导入题目。
- [x] 独立内置浏览器窗口恢复原本默认的标题规则，显示网页标题和 Workspace。
- [x] 按住 Shift 才可以拖入大样例的提示消失了，是之前关闭过一次就不会再次提示了吗？改成一道题展示一次，关闭之后对于**当前题目**不再展示。
- [x] 新增部分 AC；AC 与部分 AC 均二次确认后停止计时，取消后从冻结时长继续。
- [x] 大样例输出在文本框展示前 5 行 diff。用户仍可通过文件查看。

实现与验证记录：[Todos 完成报告](reports/todos-implementation-2026-10-04.md)。独立浏览器窗口已按确认恢复默认标题；新 macOS 成品及 Finder 未验证，导题在线验证目前覆盖 CSES，其他 OJ 与登录比赛待联调。

## 20261003

- [x] 拖入大样例之后，取消导入，仍然会解压一份到题目目录

实现与验证记录：[Priority Item 修复记录](reports/priority-items-2026-10-03.md)。VJudge 在线填表和真实点赞接口尚未做账号联调。

- [x] 点击测试点 card 三个点->期望输出->在编辑器打开->测试点变成大样例的样式。
- [x] 如果左侧 Pannel 太小，测评结果·时间·内存 会被挡住，实际上应该换行。
- [x] 提交二次确认的第二次黄色提醒被 hover 样式覆盖了。
- [x] 报错：已修复 Agent Host / Inline Chat 服务缺失，保留日志中的网络与第三方扩展问题说明。

```javascript
2026-10-02 21:45:37.840 [error] [窗口] Unable to create workbench contribution 'workbench.contrib.agentHostChatDebug'. [createInstance] yxe depends on UNKNOWN service remoteAgentHostService.
2026-10-02 21:45:37.967 [info] [窗口] Started local extension host with pid 17039.
2026-10-02 21:45:38.008 [info] [窗口] [AccountPolicyGate] apply: state=inactive, reason=undefined, isRestricted=false
2026-10-02 21:45:38.011 [error] [窗口] Unable to create workbench contribution 'workbench.contrib.customizationMigrationHint'. [createInstance] customizationMigrationService depends on remoteAgentHostService which is NOT registered.
2026-10-02 21:45:38.033 [error] [窗口] Error: [createInstance] Nvt depends on UNKNOWN service IInlineChatSessionService.
    at s._throwIfStrict (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1864:5273)
    at s._createInstance (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1864:1641)
    at s.createInstance (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1864:1440)
    at d1._runFn (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:2460:88672)
    at d1._run (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:32:6694)
    at new d1 (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:32:5832)
    at fe (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:32:8934)
    at new BCe (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:2460:88585)
    at s._createInstance (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1864:2000)
    at s.createInstance (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1864:1440)
    at s.safeCreateContribution (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:610:47103)
    at l (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:610:46704)
2026-10-02 21:45:38.036 [error] [窗口] Unable to create workbench contribution 'chat.contextContributions'. [createInstance] Jyt depends on UNKNOWN service remoteAgentHostService.
2026-10-02 21:45:38.050 [error] [窗口] Unable to create workbench contribution 'workbench.contrib.agentHostSandboxForwarder'. [createInstance] agentHostConnectionsService depends on remoteAgentHostService which is NOT registered.
2026-10-02 21:45:38.071 [warning] [窗口] Skipping extension /Users/kevin/.shortestpath-ide/extensions/quboliu.flintmark-0.32.13 in favour of the builtin extension /Applications/ShortestPath IDE.app/Contents/Resources/app/extensions/quboliu.flintmark.
2026-10-02 21:45:38.071 [error] [窗口] Extension 'Tencent-Cloud.coding-copilot CANNOT USE these API proposals 'inlineCompletionsAdditions, findFiles2, terminalSelection, findTextInFiles, terminalExecuteCommandEvent, textDocumentChangeReason, extensionsAny'. You MUST start in extension development mode or use the --enable-proposed-api command line flag
2026-10-02 21:45:38.117 [info] [窗口] [DefaultAccount] Authentication provider is not available. {"id":"","name":"","enterprise":false}
2026-10-02 21:45:38.277 [error] [窗口] [Extension Host] (node:17039) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
(Use `ShortestPath Helper (Plugin) --trace-deprecation ...` to show where the warning was created)
2026-10-02 21:45:40.436 [error] [窗口] Unable to create workbench contribution 'workbench.contrib.agentHostModeSynchronizer'. [createInstance] agentHostUntitledProvisionalSessionService depends on agentHostService which is NOT registered.
2026-10-02 21:45:40.436 [error] [窗口] Unable to create workbench contribution 'workbench.contrib.chatSlashCommands'. [createInstance] hEe depends on UNKNOWN service agentHostService.
2026-10-02 21:45:40.439 [error] [窗口] Unable to create workbench contribution 'mcpLanguageFeatures'. [createInstance] agentHostCustomizationService depends on remoteAgentHostService which is NOT registered.
2026-10-02 21:45:40.929 [info] [窗口] [perf] Render performance baseline is 10ms
2026-10-02 21:45:43.010 [info] [窗口] [AccountPolicyGate] apply: state=inactive, reason=undefined, isRestricted=false
2026-10-02 21:45:43.240 [warning] [窗口] [chat-stt] could not refresh GitHub session state for cloud dictation Timed out waiting for authentication provider 'github' to register.
2026-10-02 21:45:46.506 [error] [网络] #3: https://raw.gitcode.com/KevinHuangIsLearning/shortestpath-ide/raw/main/latest.json - error GET Failed to fetch
2026-10-02 21:45:47.802 [info] [窗口] Auto updating outdated extensions. tencent-cloud.coding-copilot
2026-10-02 21:46:28.513 [error] [窗口] Error: [createInstance] Nde depends on UNKNOWN service IInlineChatSessionService.
    at s._throwIfStrict (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1864:5273)
    at s._createInstance (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1864:1641)
    at s.createInstance (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1864:1440)
    at VOt._instantiateById (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:268:42851)
    at VOt._instantiateSome (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:268:42469)
    at VOt.initialize (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:268:41538)
    at new Qs (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:307:15826)
    at s._createInstance (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1864:2000)
    at s.createInstance (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1864:1440)
    at NZ.createEditorControl (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:984:95328)
    at NZ.createEditorControl (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:3765:94513)
    at NZ.createEditor (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:696:58693)
    at NZ.create (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:696:50914)
    at ABe.doCreateEditorPane (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:989:35386)
    at ABe.doShowEditorPane (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:989:34879)
    at ABe.doOpenEditor (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:989:34126)
    at ABe.openEditor (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:989:33136)
    at vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1102:77063
    at MS.doShowEditor (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1102:77311)
    at MS.doOpenEditor (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1102:76809)
    at MS.openEditor (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1102:75646)
    at NIe.openEditor (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:1594:46035)
    at async Sre.$tryShowTextDocument (vscode-file://vscode-app/Applications/ShortestPath%20IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js:696:35894)
```

- [x] 现在VJudge 提交自动填表需要等待网页完全加载完毕，实际上按钮出来了就可以，否则看上去像用不了的样子。（已统一处理五类内置自动提交）
- [x] 解题报告的点赞异步做了，但是题面的提示点赞没有做。
- [x] 导入测试点的二级菜单和测试点卡片菜单的二级菜单样式不同，前者是 VSCode 原声弹窗，后者是自己写的，统一更换为自己写的。
- [x] .shortestpath/bin 中的可执行文件不会遵循 shortestpath.executableCleanupDelaySeconds 设置
- [x] `oj-index.json` 文件经常重建，表现为在资源管理器中会闪一下消失，然后回来，实际上这只是一张table，应该用不着这么搞吧。导入题目的时候弄一下就好了。
- [x] 重构设置 UI，使选项更加容易寻找，做成 macOS 设置的风格，分类选项。

## 20261001

- [x] 内置 CPH 升级为自有评测插件 shortestpath.judger，参考 CPH-NG 0.7.11 补功能；实现与验证记录见 reports/judger-migration-implementation-2026-09-27.md。

- [x] 适配 CPH-NG 0.7.11 的五类提交器为内置用户脚本，自动提交由用户设置决定；线上 OJ 联调待验证。

- [x] 我重构了UI。

  请修复：a. 重复拖拽同一个样例zip文件会重复解压 b. 大样例存放位置很傻逼，应该放在题目下 c. ShortestPath OJ 的题面也应该放在对应的题目下，不然太散乱了 d.题目计时现在每次都会重写，应该记录开始时间戳，然后直接减法；新增标记 AC 功能，AC 后停止计时；e. stress testing 使用 CPH-NG 的实现，重写一份; f. 清除旧的 Large TC 的代码，已经被从 CPH-NG 参考实现的替代了。请参考 CPH- NG 实现。/Users/kevin/Downloads/cph-ng-0.7.11

- [x] 显示题解、简化设置可以改为在 VSCode 的弹窗中打开（VSCode 新版增加的一个，现在是打开高级设置会在弹窗中打开）。

- [x] 添加对于配置了 VJudge 映射的 OJ，在 CPH Plus 插件中添加通过控制浏览器 [Reference](INTEGRATED_BROWSER_API_REFERENCE.md) 的 Vjudge 题解（填写好表单即可）。
