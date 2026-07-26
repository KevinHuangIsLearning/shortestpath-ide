# Competitive Programming Helper Plus（CPH 修改版）

[English README](README.md)

> [!WARNING]
>
> **本修改版不能与原版 CPH 共存。** 为兼容既有配置，它沿用了相同的扩展标识和
> `cph.*` 设置前缀；安装本修改版会替换原版 Competitive Programming Helper。切换
> 前请备份需要保留的设置。

这是基于
[Competitive Programming Helper](https://github.com/agrawal-d/competitive-programming-helper)
的 VS Code 修改版。它可下载题目、编译运行并评测样例；本修改版额外强化了题目文件
管理和 VJudge 使用流程。

## 新增功能

-   可用模板决定新题文件的名称和目录层级，并可按 OJ 单独覆盖。
-   从可配置的 OJ 域名映射中提取 OJ、比赛和题目编号，供文件名模板使用。
-   从 VJudge 导入题目时还原原始 OJ URL，使文件命名和提交集成使用正确的题目信
    息。
-   可在 VS Code 内置浏览器中与代码左右分屏打开 VJudge 题面。
-   将所有 `.cph` 题目元数据集中保存到工作区根目录，避免散落在题目子目录中。

支持 C++、C、C#、Rust、Go、Haskell、Python、Ruby、Java、JavaScript（Node.js）和
仓颉；界面支持英文、简体中文、韩文和日文。

## 安装此修改版

在仓库根目录执行：

```sh
npm ci
npm run vscode:prepublish
npx @vscode/vsce package
```

在 VS Code 中运行 **Extensions: Install from VSIX...**，选择生成的 `.vsix` 文
件。开发调试则执行 `npm ci` 后用 VS Code 打开仓库并按 <kbd>F5</kbd>。

## 基本使用

1. 打开一个工作区并安装本扩展。
2. 安装浏览器扩展
   [Competitive Companion](https://github.com/jmerle/competitive-companion)。
3. 在题目页点击 Companion 的绿色加号，选择语言后即可导入题目和样例。
4. 使用 **CPH: Run Test Cases**，或按
   <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>B</kbd> 运行样例。

本地文件同样可直接运行该命令并手工录入测试数据。

## 修改版设置

在 VS Code 的 Settings (JSON) 中按需配置。

### 文件名模板

`cph.general.fileNameTemplate` 支持
`{name}`、`{index}`、`{slug}`、`{group}`、`{url}`、`{ext}`、`{lang}`、`{contestId}`、`{problemId}`、`{oj}`
和 `{ojName}`。设置后会覆盖旧版的短名称选项。

```json
{
    "cph.general.fileNameTemplate": "{oj}/{contestId}/{problemId}_{slug}.{ext}",
    "cph.general.fileNameTemplateOverrides": {
        "CF": "Codeforces/{contestId}/{problemId}.{ext}",
        "AT": "AtCoder/{contestId}/{problemId}.{ext}",
        "LG": "Luogu/{problemId}.{ext}"
    }
}
```

覆盖项的键是 OJ 简称，例如 `CF`、`AT`、`LG`、`HDU`；没有匹配项时会回退到全局模
板。空占位符会从路径中清理，缺失的父目录会自动创建。

### 自定义 OJ

`cph.general.ojMapping` 将域名映射为 OJ 信息。正则表达式的第一个捕获组分别作为
`{contestId}` 和 `{problemId}`：

```json
{
    "cph.general.ojMapping": {
        "my.oj.example": {
            "oj": "MYOJ",
            "ojName": "My Online Judge",
            "contestIdRegex": "contests/(\\w+)",
            "problemIdRegex": "problems/(\\w+)"
        }
    },
    "cph.general.fileNameTemplate": "{oj}/{contestId}/{problemId}.{ext}"
}
```

默认映射已包含 Codeforces、AtCoder、洛
谷、Kattis、CodeChef、SPOJ、HackerRank、HackerEarth、LeetCode、Timus、DMOJ、CSES、USACO、LightOJ、EOlymp
和 HDU。

### VJudge 分屏

```json
{
    "cph.general.vjudgeOpenInBrowser": true,
    "cph.general.vjudgeBrowserSplitRatio": 55,
    "cph.general.vjudgeUrlSuffix": "#author=translator:1281309:zh"
}
```

启用后，导入题目时会在内置浏览器打开对应的 VJudge 页
面。`vjudgeBrowserSplitRatio` 是左侧代码编辑器所占百分比，范围为
10–90；`vjudgeUrlSuffix` 会原样追加到打开的 URL。

未内置的 VJudge OJ 可通过 `cph.general.vjudgeOjNames` 添加；`urlTemplate` 支持
`{contestId}` 和 `{problemId}`，必要时用 `problemIdRegex` 将 VJudge 题号拆分。

```json
{
    "cph.general.vjudgeOjNames": {
        "51Nod": {
            "urlTemplate": "https://www.51nod.com/Challenge/Problem.html#problemId={problemId}"
        }
    }
}
```

### 集中保存元数据

```json
{
    "cph.general.collectProblemsInRoot": true
}
```

启用后，生成的 `.prob` 元数据保存到 `<工作区>/.cph/`，而不是每个源文件所在目录。
若设置了 `cph.general.saveLocation`，后者优先级更高。

## 其他说明

-   可在 CPH 设置中配置各语言的编译器、参数、超时和 `ONLINE_JUDGE`。
-   Codeforces 自动提交需要可选的
    [cph-submit](https://github.com/agrawal-d/cph-submit) 浏览器扩展。
-   Kattis 自动提交需要
    其[提交客户端和配置](https://open.kattis.com/help/submit)。
-   上游通用说明见 [用户指南](docs/user-guide.md) 和
    [开发指南](docs/dev-guide.md)。

## 许可证与致谢

本修改版延续 GPL-3.0-or-later 许可证，完整文本见 [LICENSE](LICENSE)。项目基于
Divyanshu Agrawal 的原始
[Competitive Programming Helper](https://github.com/agrawal-d/competitive-programming-helper)。
