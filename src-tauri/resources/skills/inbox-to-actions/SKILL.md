---
name: inbox-to-actions
description: 读 _inbox 的散点，提炼成行动项写入 _tasks；写前说明意图、凡写必确认。
---

# 收件箱 → 行动项

把 `_inbox` 里零散记录的想法提炼成可执行的行动项，写入 `_tasks`。

## 流程

1. 用 `read_note`（`target: { kind: "inbox" }`）读 `_inbox` 全文。
2. 逐条识别**可执行的行动项**：区分「想法/资料」与「需要去做的事」。
3. 用 `read_note`（`target: { kind: "tasks" }`）读现有 `_tasks`，避免重复。
4. 用 `edit_note` 把新行动项追加到 `_tasks`（`target: { kind: "tasks" }`）。`old_string` 选 `_tasks` 末尾的稳定锚点，`new_string` 在其后插入新条目；保证 `old_string` 唯一。

## 你拥有的工具

- `read_note`：读目标笔记全文（target 缺省=当前活动笔记；这里显式给 inbox/tasks）。
- `list_tags`：列采集区已有标签与可用颜色。
- `edit_note`：唯一 str_replace，改块/插块/删块/改任务都用它。old_string 必须唯一。
- `write_note`：整篇覆写，仅大重构时用。
- `tag_text`：用 exact 与可选 prefix/suffix 唯一定位采集区正文，添加或移除文本标签。
- `tag_create`：新建标签（color 须取自 list_tags 的 freeColors）。
- `tag_delete`：删标签定义及其所有文本标注。

## 纪律

- 动手写**之前**，先用一两句话说明你**打算把哪些条目、以什么形式写进 _tasks**。
- 所有写操作都会弹气泡让用户确认；用户可能拒绝，拒绝后不要反复重试。
- `target` 可跨文件：在看 `_inbox` 时给 `_tasks` 加行动项是正常用法。
- 不要擅自删除 `_inbox` 里的原始想法；只是提炼到 `_tasks`。
