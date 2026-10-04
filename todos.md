# Pending

- [ ] 内置 CPH 改成 CPH-NG（https://github.com/langningchen/cph-ng），并迁移原有特色功能；
- [ ] 添加二合一浏览器插件（导入题目+提交）
- [ ] 内置浏览器适配插件；

# Finished

## 20261004

- [x] 有时候会在当前目录（不是项目根目录）下新建一个 .shortestpath 文件夹，应该在根目录新建。
- [x] 在 Finder 中展示的版本号是 VSCode 的版本号。
- [x] 在内置浏览器中添加和 Competitive Companion 功能相同的插件，用于导入题目。
- [x] 独立内置浏览器窗口恢复原本默认的标题规则，显示网页标题和 Workspace。
- [x] 按住 Shift 才可以拖入大样例的提示消失了，是之前关闭过一次就不会再次提示了吗？改成一道题展示一次，关闭之后对于**当前题目**不再展示。
- [x] 新增部分 AC；AC 与部分 AC 均二次确认后停止计时，取消后从冻结时长继续。
- [x] 大样例输出在文本框展示前 5 行 diff。用户仍可通过文件查看。

实现与验证记录：[Todos 完成报告](reports/todos-implementation-2026-10-04.md)。独立浏览器窗口已按确认恢复默认标题；新 macOS 成品及 Finder 未验证，导题在线验证目前覆盖 CSES，其他 OJ 与登录比赛待联调。


- [x] 显示题解、简化设置可以改为在 VSCode 的弹窗中打开（VSCode 新版增加的一个，现在是打开高级设置会在弹窗中打开）。
- [x] 添加对于配置了 VJudge 映射的 OJ，在 CPH Plus 插件中添加通过控制浏览器 [Reference](INTEGRATED_BROWSER_API_REFERENCE.md) 的 Vjudge 题解（填写好表单即可）。
    样例脚本（id是对的，可以在vj下正确粘贴代码）：

```javascript
// 1. 点击提交按钮打开面板
const btnSubmit = document.getElementById('btn-submit');
if (btnSubmit) btnSubmit.click();

// 2. 点击「个人账号」单选按钮
const labelPersonal = document.querySelector('label[for="submitter-type1"]');
if (labelPersonal) labelPersonal.click();

// 3. 用官方 API 往 CodeMirror 填入代码
const cmElement = document.querySelector('.CodeMirror');
if (cmElement && cmElement.CodeMirror) {
  const editor = cmElement.CodeMirror;
  // 官方标准API：设置编辑器全部内容
  editor.setValue(`这里替换成你要粘贴的完整代码`);
}
```

支持用户自定义（对于单独的 OJ） JS 脚本（在简化设置里加入口，允许用户填写 js），允许用户替换打开的 URL 并提供占位符。