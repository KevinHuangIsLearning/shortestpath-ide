# ShortestPath OJ 集成

本扩展在 `ws://127.0.0.1:21474/shortestpath-oj` 连接 SPOJ 网站与 IDE，独立于 ShortestPath Judger。

连接只接受 `shortestpath-oj-v3`。网页先发送带账号、题目身份的 `bridge.hello`，检查 `protected-reader-v1` 能力并取得临时阅读公钥。旧协议和明文阅读数据均被拒绝，网站统一提示：

> 当前 IDE 版本不支持新版题目阅读，请升级后继续。

服务端将题面、提示、题解和参考代码加密给阅读器，网站和扩展宿主只转发密文。阅读 Webview 解密、排版并绘制 Canvas，完成或失败后均清理临时文本和克隆页面。阅读区域阻止普通复制、剪切、拖拽和右键操作。代码使用编辑器实际 token 配色与字体设置，主题变化时重新绘制。

样例输入输出、公开头文件、用户源码与自定义测试保留正常编辑和复制能力。提交、点赞、评分、诊断与重连继续通过当前网站连接处理。

按工作区隔离的内部缓存只保存加密阅读字段、样例及源码关联。迁移已知旧缓存时清除明文阅读字段；题解和历史题面不持久化。阅读密钥按网站 origin、账号、题目隔离，仅存在内存中，重启 IDE 后需重连获取新内容。已有源码与自定义测试保留；恢复连接不重放业务操作。

网站可通过 `shortestpath://shortestpath.shortestpath-oj/wake` 启动 IDE。发布时需配套升级 SPOJ 网站、HTTP Content Session v2 和支持 v3 的 IDE。安装包必须包含 `out/protectedReader.bundle.js` 及许可证。

Canvas 与加密交付用于提高普通复制的成本，无法阻止截图、OCR 或控制客户端运行环境后的提取。

[English](README.md)
