# Markdown 渲染改进设计

- 日期：2026-07-09
- 状态：已批准（待写实现计划）
- 范围：`src/note/editor.ts`、`src/note/preview.ts`、新增 `src/note/list-indent.ts`、`package.json` 依赖

## 1. 背景与现状

FloatNote 的笔记编辑器是 **CodeMirror 6 + 自写 live-preview decoration 插件**（Obsidian 式所见即所得），源码始终是 Markdown 文本，光标离开某块时用 widget 把语法替换为渲染结果，光标进入则回退源码。关键现状：

- `src/note/editor.ts:51` 调用 `markdown()` **无参**：未启用 GFM 表格扩展，Lezer 不识别 `|` 语法 → `preview.ts` 的 `case "Table"` 永不触发 → 表格完全不渲染，显示原始竖线文本。
- 列表：`preview.ts` 有 bullet widget 与按 `listDepth` 的缩进，但**无 Tab/Shift-Tab/Enter 的列表语义处理**。`markdownKeymap`（Enter 续行、Backspace 删标记）默认随 `markdown()` 安装，但不含 Tab；Tab 只走 `defaultKeymap`，不会按列表升降级。
- 代码块：`preview.ts` 的 `FencedCode` 分支只给每行加 `cm-preview-codeblock` CSS 类并隐藏围栏 ```` ``` ````，**无 `<pre>/<code>` 结构、无语法高亮、无语言标签、无圆角**。`@lezer/highlight` 仅用于 markdown 源码 token，与代码块内容着色无关。
- 代码块附加 UI（语言标签、复制按钮）：均无。

## 2. 目标

1. 列表 Tab 升降级：Tab 降一级、Shift-Tab 升一级；确认 Enter 续行与空项退出可用。
2. 表格正常渲染：支持 GFM 管道表格、对齐方向、单元格内联 Markdown。
3. 代码块语法高亮：未聚焦时按语言着色，聚焦时回退源码（保持行内可编辑）。
4. 代码块视觉：圆角浅灰背景（常态在、hover 略加深）、右上角语言标签。

## 3. 非目标

- 代码块复制按钮、表格列宽拖拽、Mermaid/数学公式、主题切换。
- 不引入 marked/markdown-it/remark 等 HTML 产出库，不换编辑器内核。

## 4. 总体策略

四项改动都落在现有 CodeMirror 6 + live-preview 框架内，集中在三处：

- `src/note/editor.ts`：`markdown()` 配置（GFM 表格、代码语言高亮）+ 列表 Tab keymap。
- `src/note/preview.ts`：升级 `TableWidget`、重写 `FencedCode` 视觉层、列表渲染微调。
- 依赖：新增 `@lezer/markdown`（直接依赖）、`@codemirror/language-data`。

编辑模型经确认采用 **行内可编辑 + CodeMirror 原生高亮**（不整块 widget、不引入 highlight.js）。

## 5. 详细设计

### 5.1 表格

**根因修复**：`editor.ts` 改为

```ts
import { Table, Strikethrough, TaskList } from "@lezer/markdown";
// ...
markdown({ extensions: [Table, Strikethrough, TaskList], codeLanguages }),
```

`@lezer/markdown` 加为直接依赖（目前是传递依赖，直接导入不规范）。启用 `Table` 后 Lezer 识别管道表格，`preview.ts` 的 `case "Table"` 开始触发。顺带启用 `Strikethrough`（`~~`）与 `TaskList` 语法节点。

**`TableWidget` 升级**（`preview.ts`，当前 `toDOM` 用正则逐行切）：

- 改为遍历 Lezer 树：`Table → TableRow → TableCell`，区分表头行与数据行。
- 对齐：从 `TableDelimiter` 行读取 `:--`（左）/`--:`（右）/`:-:`（居中），给对应列的 `<th>/<td>` 设 `text-align`。
- 单元格内联：递归 `TableCell` 子节点（`Strong`/`Emphasis`/`InlineCode`/`Link` 等），产出对应 HTML，不再 `textContent`。内联渲染器可独立为纯函数便于测试。
- 样式沿用 `.cm-preview-table`，补 `text-align`。
- 光标在表格任意行仍回退源码（现状不变，保持可编辑）。

### 5.2 列表 Tab 升降级

在 `editor.ts` 加专用 keymap，用 `Prec.highest` 保证优先级：

- **Tab**：光标在列表行 → 行首插入 2 空格（降级）；非列表行 → 回退默认 Tab。
- **Shift-Tab**：光标在列表行 → 删去行首最多 2 空格（升级）。
- 缩进单位 = 2 空格（匹配 CommonMark 与现有 `--list-depth` 计算）。
- **Enter 续行 / 空项退出**：确认 `markdownKeymap` 的 `insertNewlineContinueMarkup` 生效；若被 `defaultKeymap` 的 Enter 遮蔽，用 `Prec.highest` 显式重绑 `Enter`。
- 列表行判定与升降级的文本变换抽成纯函数 `src/note/list-indent.ts`（如 `indentListItem(line: string): string`、`outdentListItem(line: string): string`、`isListItemLine(line: string): boolean`），配 Vitest。

### 5.3 代码块语法高亮

- `editor.ts`：`markdown({ extensions: [Table, Strikethrough, TaskList], codeLanguages })`，`codeLanguages` 取自 `@codemirror/language-data` 的 `languages`（懒加载，覆盖 js/ts/python/rust/json/css/html/sql/bash/markdown/yaml/go 等常用语言）。新增 `@codemirror/language-data` 依赖。
- 新增一个**代码 HighlightStyle**（覆盖 `@lezer/highlight` 的 `tags.keyword/comment/string/number/variable/property/...`），与现有 markdown `highlight` 并存为两个 `HighlightStyle`，都用 `syntaxHighlighting()` 挂载。
- 效果：未聚焦时代码行由 CM 嵌套语言解析器着色；聚焦时回退源码（现状不变）。info string（` ```python `）由 CM 自动匹配语言。

### 5.4 代码块视觉（圆角 + 浅灰背景 + 右上角语言标签）

保持行内可编辑（5.3 已定），用**首/末行圆角 + 合并背景 + 内联 widget 语言标签**实现容器观感：

- `preview.ts` 的 `FencedCode` 分支：首行加 `cm-preview-codeblock-first`、末行加 `cm-preview-codeblock-last`、单行块加 `cm-preview-codeblock-single`。
- 每行 `cm-preview-codeblock`：背景浅灰、去掉行间纵向间隙使背景连成一体；首行 `border-radius: 8px 8px 0 0`、末行 `0 0 8px 8px`、单行 `8px`。
- **语言标签**：首行起始处插入内联 `Decoration.widget`，渲染 `<span class="cm-code-lang">Python</span>`，`float: right` 落到右上角；语言取自 info string（首字母大写展示；无 info string 则不显示标签）。
- **hover**：浅灰圆角背景为常态（始终在），hover 时背景略加深、标签提亮——即"鼠标停在内时保持浅灰圆角背景"。
- 字体/排版：等宽、`padding: 0 12px`；维持 `pre-wrap`（若多行换行处圆角出现缝隙，后续可改 `nowrap`+横向滚动，先按 pre-wrap）。
- 围栏 ```` ``` ```` 仍隐藏（现状逻辑保留）。
- 样式仍放 `preview.ts` 的 `EditorView.theme`（沿用现状约定，不进 `styles.css`）。

## 6. 测试

- **Vitest**：
  - `src/note/list-indent.test.ts`：Tab/Shift-Tab 在无序/有序列表行、嵌套列表行、非列表行、空行等的输入→输出。
  - 表格对齐解析纯函数测试（`:-:`/`:--`/`--:` → `text-align`）。
- **手动**：`npm run tauri dev`，macOS 上验证表格渲染+对齐+单元格内联、Tab/Shift-Tab/Enter 列表、代码块高亮+圆角+语言标签+hover。
- **类型**：`npm run build` 通过 tsc。
- **跨平台**：纯前端/CSS，无平台 API；macOS 与 Windows 表现应一致。如启用代码块横向滚动则在两平台验证。

## 7. 依赖变更

- 新增 `@lezer/markdown`（直接依赖，GFM 扩展 `Table`/`Strikethrough`/`TaskList`）。
- 新增 `@codemirror/language-data`（`codeLanguages` 一套常用语言，懒加载）。
- 不引入 highlight.js / prism / shiki / marked / markdown-it。

## 8. 风险与回退

- **markdownKeymap 与 defaultKeymap 的 Enter 优先级**：可能被遮蔽。回退方案：`Prec.highest` 显式重绑。
- **行内代码块圆角在换行处的缝隙**：pre-wrap 下多行换行可能破坏连续背景。回退方案：改 `nowrap`+横向滚动。
- **`@codemirror/language-data` 体积**：懒加载分块，Tauri 本地打包影响小；若顾虑可改为按需引入少量 `@codemirror/lang-*`。
- **`TableWidget` 内联渲染器**：递归 Lezer 树节点的工作量较大；若范围超期，可先只做对齐+`textContent`，内联作为后续迭代。
