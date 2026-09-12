- [x] 显示题解、简化设置可以改为在 VSCode 的弹窗中打开（VSCode 新版增加的一个，现在是打开高级设置会在弹窗中打开）。
- [ ] 添加对于配置了 VJudge 映射的 OJ，在 CPH Plus 插件中添加通过控制浏览器 [Reference](INTEGRATED_BROWSER_API_REFERENCE.md) 的 Vjudge 题解（填写好表单即可）。
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