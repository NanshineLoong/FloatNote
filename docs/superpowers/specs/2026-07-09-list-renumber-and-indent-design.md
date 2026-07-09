# 列表自动重编号 + 缩进视觉对齐 设计

日期：2026-07-09
范围：`src/note/preview.ts`、`src/note/list-indent.ts`（及测试）

## 背景与问题

当前列表（CM6 + `@codemirror/lang-markdown` live-preview）存在四类问题：

1. **有序列表缩进后不重编号**：有序列表的编号是写死在源码文本里的（`1.` `2.`），缩进/取消缩进只改前导空格，不碰数字。把第 2 项缩进成第 1 项的子项后，源码里仍是 `2.`，显示也是 `2.`，而不是子列表的 `1.`。
2. **返回上一级不恢复编号**：同上根因——数字是静态文本。
3. **无序 marker 不分层级**：`BulletWidget` 对所有层级恒输出 `•`（`preview.ts:59`）。
4. **缩进太深 + Backspace 与缩进不对齐**：视觉缩进 = 源码 4 空格 + CSS `depth * 1em + 0.6em`（`preview.ts:917`）。源码空格与 CSS 层深 **双重叠加**，且二者可能不同步（手动敲 8 空格但树只认 1 级时，`--list-depth=1` 而源码 8 空格）。Backspace 只删源码 4 空格，但视觉还叠着 CSS 的 `1em`，造成“一次删除没退一级”的错位感。

## 用户决策（已确认）

- 有序列表：**每层都用 `1. 2. 3. 4.`，但缩进/取消缩进后按层级自动重排**（不引入 A/B/C 等其它符号）。
- 无序列表：**所有层级统一 `•`**（保持现状，不动）。
- 缩进：**保留 4 空格源码缩进，仅去掉 CSS 的层级叠加 padding**。视觉一级 = 4 字符，Backspace 一次 = 退一级。

## 设计

### 1. 有序列表动态重编号（核心）

把有序列表 marker 从“染色保留文本”改为“替换为按树结构计算序号的 widget”，序号完全由列表树结构算出，与源码里写的是什么数字无关。

**计算方式（无状态、按节点自洽，天然处理列表边界）**：对每个有序 `ListMark` 节点，取其父 `ListItem`，沿 `prevSibling` 链统计同为 `ListItem` 的前驱个数 `k`，序号 = `k + 1`。不同 `OrderedList` 父节点之间，`prevSibling` 链自然在边界断开 → 自动从 1 重计。嵌套层级无需特殊处理：每条 `OrderedList` 各自独立计数。

实现要点：
- `src/note/preview.ts` `ListMark` 分支（`preview.ts:555-574`）的 `else`（有序）分支：由 `Decoration.mark({class:"cm-preview-ol-mark"})` 改为 `Decoration.replace({ widget: new OlNumberWidget(ordinal) })`。
- 新增 `OlNumberWidget`（仿 `BulletWidget`，`preview.ts:56-62`）：`toDOM` 输出 `<span class="cm-preview-ol-mark">${ordinal}</span>`，复用现有 `.cm-preview-ol-mark` 样式（`preview.ts:916`）。
- 新增纯函数 `olOrdinal(listMarkNode: SyntaxNode): number`：取 `listMarkNode.parent`（`ListItem`），沿 `prevSibling` 计数 `ListItem` 前驱，返回 `+1`。
- **序号必须在 `touches` 门控之前计算**：当前 `if (touches(node.from, node.to)) return false`（`preview.ts:556`）会跳过整段装饰。改为：先算 `ordinal`，再判断 `touches`——`touches` 时跳过 widget 推送，但本项的序号已被后续项统计依赖（实际上 `olOrdinal` 是无状态的，每项独立从树算，不受此影响，所以这点对正确性无影响；保留原门控行为即可，即光标触及 marker 时显示原始文本以便编辑）。
- 有序判定：保持现有“非 `- * +` 即有序”的分支即可（亦可收紧为 `/^\d+[.)]/`，非必须）。

**语义**：源码里写的数字不再决定显示序号；显示恒为该列表内从 1 开始的顺序号。缩进成子项 → 子 `OrderedList` 内从 1 重计；取消缩进回父级 → 父 `OrderedList` 内按位置重计。导出/保存的源码仍是用户手敲的原始数字（与 Typora 一致：源码不动，live-preview 重算）。

> 备选（不在本期）：缩进时把源码数字归一化为 `1.`，使保存文件也“干净”。会增加文本改写复杂度，暂不做。

### 2. 无序 marker

不改。`BulletWidget` 继续 `•`（已满足“所有层级统一”）。

### 3. 缩进视觉对齐

`preview.ts:917-920` `.cm-preview-list`：

```
paddingLeft: "calc(var(--list-depth, 0) * 1em + 0.6em)"   // 现
paddingLeft: "0.6em"                                       // 改
```

去掉 `depth * 1em` 叠加。`--list-depth` 数据属性与 `listLineDepth` 装饰**保留**（OL 重编号不需要它，但保留无害；若想彻底简化可一并移除，非必须）。`0.6em` 作为所有列表行统一的左侧基线偏移保留。

效果：视觉每级缩进 = 源码 4 空格（已由 CM6 渲染前导空格提供），不再叠加 CSS 层深。Backspace 一次删 4 空格 = 视觉退一级，完全对齐。

### 4. Backspace / Tab keymap

**不改逻辑**。`list-keymap.ts` 中：
- `handleBackspace`（`list-keymap.ts:65-80`）已是“行首有空白时删一个 4 空格单位”，与改后的视觉一级严格一一对应。问题纯粹是视觉错位，CSS 修好后即解决。
- `handleTab` / `handleOutdent` / `canDemote` 约束保持不变。
- `INDENT = "    "`（4 空格）保持不变。

## 测试

- `list-indent.test.ts`：现有缩进/`canDemote` 单测保持绿。新增 `olOrdinal` 纯函数单测：单层连续、嵌套子列表各自从 1、列表间边界重置、空行/非列表行打断。
- 手测（`npm run tauri dev`）：
  1. `1. a` `2. b` `3. c` → 显示 1/2/3；把 `2.` 缩进成 `1.` 的子项 → 子项显示 `1.`；再续一项 → `2.`；取消缩进回顶层 → 恢复 `2.`、`3.` 顺序。
  2. 无序列表多层均 `•`。
  3. 视觉每级缩进 ≈ 4 字符；行首 Backspace 一次退一级，无残留 CSS 错位。
  4. 光标触及 OL marker 时显示原始数字（可编辑），移开后显示计算序号。

## 影响面

- 仅前端 TS，无 Rust/文件系统/权限改动，跨平台无差异。
- 不改变保存的 Markdown 源码（数字仍是用户手敲值）。
- 向后兼容：已有笔记的有序列表显示会从“按手敲数字”变为“按顺序号重排”——这正是期望行为。
