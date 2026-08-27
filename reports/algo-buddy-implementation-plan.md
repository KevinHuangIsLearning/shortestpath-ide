# Algo Buddy 宠物陪练方案

原则：**think twice, code once**。宠物只做轻量提醒和解释，不自动改代码、不代写代码、不上传代码或活动数据。

## JSON 驱动

核心原则：**all things configurable**。代码只提供事件、定时器、clangd 语义查询、SPOJ 权限检查和 overlay 渲染；宠物行为全部由内置 JSON 配置选择。用户设置只选择配置包或覆盖少量安全参数，不直接执行任意动作。

| JSON 配置项 | 示例内容 | 作用 |
| --- | --- | --- |
| 宠物包 | 名称、贴图、状态动画、主题变体、减少动态效果替代样式 | 可换角色而不改逻辑 |
| 触发器 | `codeRisk`、`idle`、`spojStuck` 的阈值、前置条件、冷却、去重键 | 调整提醒频率与范围 |
| 行为 | 走向代码、回角落、气泡位置、优先级、持续时间 | 调整互动而不碰编辑器逻辑 |
| 文案 | English、简体中文、梗体中文的提示、按钮、风险说明、修复说明 | 同一规则按 locale 替换显示，不改变行为 |
| 规则目录 | 规则 ID、严重度、支持语言、是否要求 clangd/SPOJ | 控制功能发布与灰度启用 |

不配置化的部分：代码语义判定、SPOJ 权限/题解锁定、可执行的代码编辑、网络请求和编辑器 DOM/overlay 边界。这些必须由受审查的代码固定实现，JSON 只能引用预注册的规则和动作，不能注入脚本或命令。

### 一个角色一个 JSON

每个角色包一个 JSON，例如 `resources/algo-buddy/characters/capybara.json`、`resources/algo-buddy/characters/night.json`。用户所谓“换皮肤”在产品上是切换当前角色包；每个角色的互动动作、动画帧和三种语言台词完全独立。图片仅能引用该角色包内、已验证的相对资源路径。

```json
{
  "schemaVersion": 1,
  "id": "capybara",
  "displayName": "水豚 Buddy",
  "assetsRoot": "./capybara",
  "layout": { "width": 96, "height": 96, "scale": 1, "safeMargin": 12, "zIndex": "overlay" },
  "animations": {
    "idle": { "frames": ["idle-1.png", "idle-2.png"], "fps": 2, "loop": true, "flipForDirection": false },
    "walk": { "frames": ["walk-1.png", "walk-2.png"], "fps": 8, "loop": true, "flipForDirection": true },
    "alert": { "frames": ["alert-1.png", "alert-2.png"], "fps": 5, "loop": false, "flipForDirection": true }
  },
  "interactions": {
    "codeRisk": { "entryAnimation": "walk", "animation": "alert", "target": "diagnostic", "priority": 100, "maxVisibleMs": 8000, "bubble": "codeRisk", "actions": ["explainIntegerOverflow", "showSafeMultiplyFix", "dismiss"] },
    "syntaxError": { "entryAnimation": "walk", "animation": "alert", "target": "diagnostic", "priority": 100, "maxVisibleMs": 8000, "bubble": "syntaxError", "actions": ["explainSyntaxError", "dismiss"] },
    "idle": { "animation": "idle", "target": "editor.bottomRight", "priority": 10, "maxVisibleMs": 5000, "bubble": "idle", "actions": ["dismiss", "snooze"] },
    "spojStuck": { "animation": "alert", "target": "editor.bottomRight", "priority": 20, "maxVisibleMs": 10000, "bubble": "spojStuck", "requires": ["spoj.connected", "spoj.activeProblem"], "actions": ["snooze", "spoj.openHint", "spoj.openEditorial"] }
  },
  "locales": {
    "en": { "codeRisk": ["This multiplication may overflow before widening."], "syntaxError": ["Looks like a semicolon is missing here."], "idle": ["Still thinking? Want to keep going?"], "spojStuck": ["Stuck for a while? Try a hint before the editorial."], "actions": { "dismiss": "Got it", "snooze": "Later" } },
    "zh-CN": { "codeRisk": ["这里可能会先溢出喔。"], "syntaxError": ["这里好像少了一个分号。"], "idle": ["这题还没写完呢，要继续试试吗？"], "spojStuck": ["卡了一会儿，要不要换个思路？"], "actions": { "dismiss": "知道了", "snooze": "等会儿" } },
    "zh-CN-meme": { "codeRisk": ["警报：这个乘法可能先寄了。"], "syntaxError": ["分号同学好像走丢了。"], "idle": ["思路加载中？"], "spojStuck": ["这题有点硬，先来一点提示回血？"], "actions": { "dismiss": "我懂", "snooze": "稍后再战" } }
  },
  "reducedMotion": { "walk": "fade", "alert": "static" },
  "voice": { "enabledByDefault": false, "rate": 1, "volume": 0.6 }
}
```

触发阈值、规则严重度、冷却和代码诊断仍在独立的内置规则 JSON 中维护，不与角色包混杂。例如：

```json
{
  "schemaVersion": 1,
  "rules": [
    { "id": "integer-multiply-widening", "kind": "codeRisk", "enabled": true, "language": ["cpp", "c"], "requires": ["clangd.ast"], "severity": "warning", "dedupe": "document-and-expression-until-changed", "debounceMs": 800, "interaction": "codeRisk" },
    { "id": "missing-semicolon", "kind": "syntaxError", "enabled": true, "requires": ["clangd.diagnostics"], "diagnosticCodes": ["expected_semi"], "debounceMs": 800, "interaction": "syntaxError" },
    { "id": "idle-reminder", "kind": "idle", "enabled": false, "when": { "windowFocused": true, "noActivityForSeconds": 600, "ignoreDuring": ["run", "debug", "selection", "scroll"] }, "cooldownSeconds": 1200, "interaction": "idle" },
    { "id": "spoj-stuck-guide", "kind": "spojStuck", "enabled": false, "requires": ["spoj.connected", "spoj.activeProblem"], "when": { "noProgressForSeconds": 1500, "or": [{ "failedRuns": 3 }, { "failedSubmissions": 2 }] }, "cooldownSeconds": 2700, "interaction": "spojStuck" }
  ]
}
```

`showSafeMultiplyFix`、`spoj.openEditorial` 等只能是代码预注册的动作 ID；JSON 不能执行任意代码。

### JSON 字段说明

以下字段对应上方所有示例。`string[]` 表示字符串数组，`boolean` 表示真/假，`number` 表示数字。

| 字段路径 | 类型 | 含义与约束 |
| --- | --- | --- |
| `schemaVersion` | `number` | JSON 格式版本；加载前先校验，后续升级可迁移旧角色包。 |
| `id` | `string` | 配置项唯一 ID；用于去重、设置和引用，发布后应保持稳定。 |
| `displayName` | `string` | 当前角色的显示名称。 |
| `assetsRoot` | `string` | 当前角色图片资源根目录；必须是角色包内的相对路径，不允许 URL 或上级目录跳转。切换“皮肤”即切换到另一个角色 JSON。 |
| `layout` | `object` | 角色在 overlay 中的固定视觉尺寸与安全边距。 |
| `layout.width` / `layout.height` | `number` | 角色基准宽高（像素）；渲染端必须设上限。 |
| `layout.scale` | `number` | 基准缩放倍率；用户可在安全范围内覆盖。 |
| `layout.safeMargin` | `number` | 宠物距编辑器边缘和悬浮 UI 的最小间距。 |
| `layout.zIndex` | `string` | 预定义 overlay 层级，如 `overlay`；不可指定任意层级数值。 |
| `animations` | `object` | 动画表，键名是动画 ID，如 `idle`、`walk`、`alert`。 |
| `animations.<animation>` | `object` | 某一动画的帧序列与播放参数。 |
| `animations.<animation>.frames` | `string[]` | 图片帧文件名，按顺序播放；从当前角色的 `assetsRoot` 解析。 |
| `animations.<animation>.fps` | `number` | 每秒帧数，需限制为安全范围以避免性能问题。 |
| `animations.<animation>.loop` | `boolean` | 是否循环播放；例如待机循环、提醒通常不循环。 |
| `animations.<animation>.flipForDirection` | `boolean` | 向左移动时是否镜像图片帧，避免为左右移动重复存图。 |
| `interactions` | `object` | 互动表，键名是事件 ID，如 `codeRisk`、`syntaxError`、`idle`、`spojStuck`。 |
| `interactions.<event>` | `object` | 某一事件发生时的角色表现与按钮。 |
| `interactions.<event>.animation` | `string` | 使用的动画 ID，必须存在于 `animations`。 |
| `interactions.<event>.entryAnimation` | `string` | 前往目标位置时使用的动画 ID；缺失时直接出现。 |
| `interactions.<event>.target` | `string` | 展示锚点，如 `diagnostic` 或 `editor.bottomRight`；仅接受预定义位置。 |
| `interactions.<event>.priority` | `number` | 互动优先级；同时命中时只展示数值最高的一项。 |
| `interactions.<event>.maxVisibleMs` | `number` | 气泡最长可见毫秒数；用户交互可提前关闭。 |
| `interactions.<event>.bubble` | `string` | 从当前 locale 取台词的事件键，如 `codeRisk`。 |
| `interactions.<event>.actions` | `string[]` | 可显示的预注册动作 ID；按顺序展示，不允许任意命令。 |
| `interactions.<event>.requires` | `string[]` | 此互动额外所需能力；示例中的 SPOJ 互动要求已连接且有活动题目。 |
| `reducedMotion` | `object` | 系统或用户启用“减少动态效果”时的状态替换表。 |
| `reducedMotion.<animation>` | `string` | 原动画的替代视觉，如 `fade` 或 `static`。 |
| `kind` | `string` | 触发器类别：`codeRisk`、`idle` 或 `spojStuck`。 |
| `rules` | `object[]` | 独立规则 JSON 的规则数组；角色包不包含此字段。 |
| `enabled` | `boolean` | 此配置包默认是否启用；用户设置可覆盖。 |
| `language` | `string[]` | 适用的文档语言 ID；例如 `cpp`、`c`。缺失时表示不按语言过滤。 |
| `requires` | `string[]` | 必须已满足的能力/会话条件，如 `clangd.ast`、`spoj.connected`、`spoj.activeProblem`；任一不满足则不触发。 |
| `severity` | `string` | 诊断严重级别；首期使用 `warning`，由代码映射到 VS Code 标准等级。 |
| `dedupe` | `string` | 去重策略；`document-and-expression-until-changed` 表示同一文档同一表达式在修改前只提示一次。 |
| `debounceMs` | `number` | 编辑停止后等待的毫秒数，避免每次击键触发分析或动画。 |
| `diagnosticCodes` | `string[]` | 可映射到互动的 clangd 诊断代码白名单，如 `expected_semi`。 |
| `interaction` | `string` | 规则命中后引用角色 JSON 中的互动 ID。 |
| `when` | `object` | 触发条件组合；字段全部满足，除 `or` 外。 |
| `when.windowFocused` | `boolean` | 是否要求 IDE 窗口处于前台。 |
| `when.noActivityForSeconds` | `number` | 无活动秒数阈值；用于通用专注提醒。 |
| `when.noProgressForSeconds` | `number` | 无有效进展秒数阈值；仅用于 SPOJ 卡题引导。 |
| `when.ignoreDuring` | `string[]` | 不计入无活动的状态，如 `run`、`debug`、`selection`、`scroll`。 |
| `when.or` | `object[]` | 条件或组；任意一个对象成立即可，例如失败次数达到阈值。 |
| `when.or[].failedRuns` | `number` | 本地运行失败次数阈值。 |
| `when.or[].failedSubmissions` | `number` | SPOJ 提交失败次数阈值；仅互通会话可用。 |
| `cooldownSeconds` | `number` | 成功展示后再次允许展示前的冷却秒数。 |
| `presentation` | `object` | 宠物展示和可交互内容。 |
| `presentation.petState` | `string` | 展示时使用的宠物状态 ID；未写时使用默认状态。 |
| `presentation.message` | `string` | 气泡主文案；正式实现可替换为文案键，按 locale 解析。 |
| `locales` | `object` | 语言包映射，键为 locale ID。 |
| `locales.en` | `object` | English 文案包。 |
| `locales.zh-CN` | `object` | 简体中文文案包。 |
| `locales.zh-CN-meme` | `object` | 梗体中文文案包；只改语气，不得降低风险或权限提示的准确性。 |
| `locales.<locale>.codeRisk` | `string[]` | 代码风险场景的候选台词。 |
| `locales.<locale>.idle` | `string[]` | 无活动场景的候选台词。 |
| `locales.<locale>.spojStuck` | `string[]` | SPOJ 卡题场景的候选台词。 |
| `locales.<locale>.syntaxError` | `string[]` | 语法错误场景的候选台词。 |
| `locales.<locale>.actions` | `object` | 该语言下按钮动作的显示名称。 |
| `locales.<locale>.actions.<action>` | `string` | 某个预注册动作 ID 的按钮文字，如 `dismiss`、`snooze`。 |
| `voice` | `object` | 可选语音参数；首期只展示气泡。 |
| `voice.enabledByDefault` | `boolean` | 语音是否默认开启；必须为 `false`。 |
| `voice.rate` | `number` | 语速倍率。 |
| `voice.volume` | `number` | 音量，范围为 `0` 到 `1`。 |

| 模块 | 面向用户 | 触发条件（初始值） | 宠物行为 | 边界 |
| --- | --- | --- | --- | --- |
| 代码风险与语法错误 | 所有 C/C++ 用户 | clangd 已稳定分析；命中高置信度规则或已有语法诊断；停止输入 800 ms | 走到对应行旁，提示原因与修复建议 | 首期覆盖 `int * int` 后才拓宽、过晚强转及漏分号；漏分号复用 clangd 诊断，不自建 C++ 解析器；仅作提示，不修改代码。 |
| 专注陪伴 | 所有用户 | IDE 前台，或者 IDE 在后台挂机且题目打开；10 分钟无编辑、选择、运行、调试、滚动，或者仅切换页面，没有键入代码。或者没有使用 IDE。 | 右下角一次轻提醒 | 运行、阅读、选择、窗口失焦不算摸鱼；20 分钟冷却；默认无声音、无系统通知 |
| 卡题引导 | **仅 ShortestPath OJ 互通用户** | 互通可用且已有绑定题目；25 分钟无有效进展或连续 3 次失败 | “再想想 / 给提示 / 查看题解” | 未使用、未连接或没有活动 SPOJ 题目时完全不显示；45 分钟冷却 |
| 题解与提示 | **仅 ShortestPath OJ 互通用户** | 用户主动点击卡题引导 | 打开现有提示或题解面板 | 严格复用既有权限与解锁状态，不绕过平台限制 |

## 实现范围

| 层 | 职责 | 约束 |
| --- | --- | --- |
| Algo Buddy 扩展 | 读取 JSON 配置；规则、活动计时、状态机、设置、诊断与操作入口 | 通用功能不依赖 SPOJ；SPOJ 功能做成可选适配器；JSON 只引用白名单动作 |
| clangd | 通过 AST/LSP 确认 C++ 表达式真实类型 | 不用文本正则猜语义；不读写全局 clangd 配置或用户自有 `.clangd` |
| 编辑器覆盖层 | 宠物位置、走动、气泡、避让 | ShortestPath 是 Code - OSS fork，需受控 overlay；目标行不可见则回角落；补全和 hover 优先 |
| 既有系统 | Problems、Error Lens、本地运行、SPOJ 互通 | 代码诊断独立存在；关闭动画后诊断仍可用 |

## 分期与验收

| 阶段 | 交付 | 关键验收 |
| --- | --- | --- |
| 1. 风险 MVP | 一条溢出规则、漏分号语法诊断映射、行旁静态宠物气泡 | `long long x=a*b` 提示；`1LL*a*b` 不提示；漏分号走到对应行；改动后旧提示消失 |
| 2. 陪伴 | 前台活动计时、提醒和冷却、设置开关 | 正常运行、调试、阅读、切出 IDE 不误提醒 |
| 3. SPOJ 适配 | 绑定题目后的卡题引导与提示/题解入口 | 非 SPOJ 用户零题解入口；永不绕过题解权限 |
| 4. 动画打磨 | 跨行走动、减少动态效果、性能降级 | 滚动、分屏、折叠、缩放时不遮挡、不残留、不报错 |

## 开发前确认

| 项目 | 建议 |
| --- | --- |
| 默认开关 | 开启代码风险；无活动与卡题提醒由用户首次选择 |
| 显示语言 | 默认跟随 IDE 语言；支持 English、简体中文、梗体中文，且可在 Algo Buddy 设置中单独覆盖 |
| 配置机制 | 内置版本化 JSON 宠物包；先不开放任意第三方脚本配置，只允许安全字段与白名单规则/动作 |
| 宠物形象 | 先确定形象、主题适配和“减少动态效果”模式 |
| 非 SPOJ 的“给提示” | 首版不提供，避免对未知题目进行误导性建议 |
| 题解契约 | 开发 SPOJ 适配前重新核对当前互通协议、题解锁定与提示权限 |
