# Changelog

## 0.4.7 — 2026-10-07

- 新增独立 Dashboard（仪表盘）页面，展示做题热力图、单日最多 AC 的日期与数量，以及单题最长用时。
- 支持调整统计范围、筛选来源与状态；默认列出范围内全部题目，点击热力图查看当天，并可清除日期选择。
- 题目以列对齐的紧凑列表展示，提供来源 OJ、完整完成状态和用时；打开题目会进入浏览页面。
- 兼容旧版与缺少可选字段的题目记录；缺少 AC 时间时按题目创建日期统计。
- 计时上限为 5 小时。超时且没有标记的题目单独列出并计入创建日期热力图；修改状态需二次确认，修改后保留创建日期及 5:00:00+ 用时。

### English

- Added a standalone Dashboard with a problem activity heatmap, the date and count of the busiest AC day, and the longest time spent on a problem.
- Adjust the period and filter by source or status. The list initially shows all problems in the selected period; select a heatmap day to narrow it down and clear the selection to show all again.
- Problems use a compact, aligned list with source OJ, full completion status, and elapsed time. Open Problem opens the browsing page.
- Supports legacy records and missing optional fields. Problems without an AC timestamp are counted on their creation date.
- Timers are capped at five hours. Overdue unmarked problems appear separately and count toward the creation-date heatmap. Changing their status requires confirmation and preserves the creation date and 5:00:00+ elapsed time.

历史更新与下载说明 / Earlier releases and downloads: [docs/release-notes.md](docs/release-notes.md).
