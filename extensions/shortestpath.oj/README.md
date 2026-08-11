# ShortestPath OJ Integration

This built-in extension implements the official local interoperability protocol
between ShortestPath OJ and ShortestPath IDE. It remains independent from CPH Plus.

After activation, the IDE listens on:

```text
ws://127.0.0.1:21474/shortestpath-oj
```

The required WebSocket subprotocol is `shortestpath-oj-v1`. A page binds with
`problem.bind` and replaces website state with `problem.state.sync`. The IDE uses
the active connection for hint answers, likes, editorials, submissions, and
problem-level stress testing, and receives judge and stress snapshots. Only one
problem is active globally. `problem.ref` is the update key; a successful new
binding replaces and closes the old page session.

When the IDE is not running, a user click on the website may open:

```text
shortestpath://shortestpath.shortestpath-oj/wake
```

Imported statements appear beside the editor and samples are forwarded to CPH
Plus. The problem cache and CPH-created source path mapping are stored in the
current workspace as one `.shortestpath/<problem-ref>.json` file per problem
(for example, `.shortestpath/ACOMB.found.A.json`). Legacy aggregate caches are
automatically migrated when first read. The extension never
replays website operations after a disconnect; reconnect from the problem page.

[中文](README_cn.md)
