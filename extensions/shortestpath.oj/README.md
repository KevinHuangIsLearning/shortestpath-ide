# ShortestPath OJ Integration

This built-in extension connects ShortestPath OJ to ShortestPath IDE at
`ws://127.0.0.1:21474/shortestpath-oj`. It is independent of ShortestPath Judger.

The required subprotocol is `shortestpath-oj-v3`. The website first exchanges
`bridge.hello` with the account and problem identity, checks `protected-reader-v1`,
and obtains an ephemeral reading public key. Old subprotocols and plaintext
reading payloads are rejected. The website displays this upgrade message:

> 当前 IDE 版本不支持新版题目阅读，请升级后继续。

The server encrypts statements, hints, editorials and reference code for the
reader. The website and extension host relay ciphertext. Only the reading
Webview decrypts it, lays it out and paints Canvas; temporary text and cloned
documents are removed after rendering, including failed renders. Reading areas
block ordinary copy, cut, drag and context-menu actions. Code uses the editor's
resolved token colors and font settings, and redraws when the theme changes.

Sample input/output, public judge headers, user source and custom tests retain
their normal editing and copying behavior. The active website connection also
handles submissions, likes, rating, diagnostics and recovery.

Workspace-specific internal caches store encrypted reading fields, sample data
and source associations. Recognized legacy caches are migrated with plaintext
reading fields removed. Editorials and statement history are not persisted.
Reading keys are memory-only, scoped to origin/account/problem; after an IDE
restart, reconnect to obtain fresh content. Existing source files and custom
Judger tests are preserved. Recovery does not replay business mutations.

The website can wake the IDE using
`shortestpath://shortestpath.shortestpath-oj/wake`. Deploy the matching SPOJ HTTP
Content Session v2 and website with a v3-capable IDE. The production extension
must include `out/protectedReader.bundle.js` and its license notices.

Canvas and encrypted delivery deter ordinary copying; they do not prevent
screenshots, OCR or extraction by a user who controls the client runtime.

[中文](README_cn.md)
