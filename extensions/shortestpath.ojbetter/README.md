# OJBetter for ShortestPath IDE

内置浏览器打开 AtCoder 或 Codeforces 时自动启用 Better。页面中的 **Atcoder Better! 设置** / **Codeforces Better! 设置** 控制网站本地化、题面翻译、主题、代码块和编辑器等上游功能。

自定义设置页面的 **工具 → 内置浏览器** 提供两个开关，对应 `shortestpath.ojbetter.atcoder`、`shortestpath.ojbetter.codeforces`，默认开启。更改开关后刷新已有页面。两个网站分别保存偏好，不占用网站的 localStorage；上游设置面板的保存和自动刷新会等待持久化完成。

## 固定资源与许可

来源：[beijixiaohu/OJBetter](https://github.com/beijixiaohu/OJBetter)，提交 `860106c63ef7bb7d4ec5dcd709f80a9f9a6f1a46`，作者北极小狐，GPL-3.0。Atcoder Better! **1.25.1**，Codeforces Better! **1.87.1**。`resources/vendor/*-better.user.js.txt` 保留原始脚本和文件头；`OJBetter-LICENSE` 保留上游许可。

依赖版本由脚本的 `@require` 固定：Turndown 7.2.0、markdown-it 13.0.2、CryptoJS 4.2.0、chroma-js 2.4.2、xterm 5.5.0、Dexie 4.0.7、i18next 23.11.5、i18next-http-backend 2.5.2、jquery-i18next 1.2.1、highlight.js 11.9.0、dialog-polyfill 0.5.6；另外内置 jQuery 3.7.1、SelectPage 2.19.0、Monaco 0.49.0 和 KaTeX 0.16.22。完整第三方许可见 `resources/ThirdPartyNotices.txt` 和 `resources/vendor/`。

脚本、依赖、字体、worker、语言包、补全和编译器列表均本地打包。`resources/manifest.json` 记录原始下载 URL、上游 SRI（如提供）和全部资源的 SHA-256；运行时校验全部资源。脚本随 IDE 更新，关闭上游自动更新检查。翻译、在线编译、LSP 等外部服务仍使用上游设置指定的服务。

## 实现边界

使用 `browser` proposed API 和每标签页独立 CDP 会话，在名为 `shortestpath-ojbetter` 的 isolated world 执行脚本。GM 存储、剪贴板和 HTTP 桥接仅接受该 world 的当前顶层文档请求；普通网页脚本没有桥接入口。离开目标网站时拒绝特权调用，导航销毁上下文时取消请求。与 Judger 的 CDP 会话并存。

只通过固定只读表达式读取网站的 CSRF token 和已有 Ace 代码内容。请求仅允许 HTTP(S)，同源请求可使用当前站点 Cookie；跨源重定向移除认证信息。流式响应按块传递，支持取消和超时。

适配位于 `src/assets.ts`：离线加载依赖、i18next 和 Monaco；Codeforces 新增翻译内容使用本地 KaTeX 渲染；设置刷新等待 GM 写入完成。原始网站内容和上游资源保持各自归属。该桥接不依赖通用 Marketplace 扩展。

## 开发与更新

```sh
npm test --prefix extensions/shortestpath.ojbetter
npm run compile-oi-extensions
```

启动源码版 IDE 后用内置浏览器访问两站。诊断在 **OJBetter** 输出频道。构建链将本扩展作为预编译内置扩展保留；三平台发布流程检查入口及全部资源 hash。

更新时先固定新的上游提交，复制 release 脚本和对应 `resources/locales`、`i18n/*/resources/locales`。根据脚本元数据下载依赖并验证 SRI，记录 URL 和许可证。Monaco 的 npm `esm/vs/editor/editor.main.js` 使用 esbuild 0.28.1 构建为浏览器 IIFE（`globalName: shortestpathMonaco`、minify、`legalComments: eof`、`.ttf: dataurl`）；editor/json/css/html/typescript worker 分别构建 IIFE，保留 Monaco LICENSE 和 ThirdPartyNotices。KaTeX CSS 字体内联为 data URL。生成资源 SHA-256 清单，检查适配器函数边界和测试，再进行真实浏览器回归。不要仅更新版本号或 hash 来绕过校验。

2026-10-09 已在真实源码版 IDE 中验证双站设置保存/刷新、编辑器与 JSON worker、流式 HTTP 桥接及导航边界；登录提交和需个人凭据的付费服务应使用自己的账号设置验证。
