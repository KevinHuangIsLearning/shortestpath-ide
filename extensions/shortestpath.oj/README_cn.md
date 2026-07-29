# ShortestPath OJ 集成

此内置扩展按 ShortestPath OJ 官方开发者接入文档实现网站与 ShortestPath IDE 的本地互通，
并保持独立于 CPH Plus。

扩展启动后监听：

```text
ws://127.0.0.1:21474/shortestpath-oj
```

WebSocket 子协议固定为 `shortestpath-oj-v1`。网页通过 `problem.bind` 发送题目并通过
`problem.state.sync` 覆盖网站状态；IDE 沿同一活动连接请求提示答案、点赞、解题报告、
代码提交和题目级对拍，并接收评测与对拍进度。全局只保留一道活动题目，题目以
`problem.ref` 为更新键；新题绑定成功后，旧网页会收到 `session.replaced` 并断开。

如果 IDE 尚未启动，网页中的用户点击可以打开：

```text
shortestpath://shortestpath.shortestpath-oj/wake
```

导入后的题面显示在 IDE 右侧，样例交给 CPH Plus。题目缓存与 CPH Plus 创建的源文件映射
保存在当前工作区的 `.shortestpath/oj-problems.json`。断线后扩展不会自动重放网站操作；
请回到题目网页重新点击“在 ShortestPath IDE 中打开”。

[English](README.md)
