# Markdown 渲染改进 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 FloatNote 笔记编辑器的 Markdown 渲染四项问题：列表 Tab 升降级、表格渲染、代码块语法高亮、代码块圆角/语言标签/横向滚动样式。

**Architecture:** 全部落在现有 CodeMirror 6 + 自写 live-preview（`src/note/preview.ts`）框架内。表格通过启用 `@lezer/markdown` 的 GFM 扩展 + 升级 `TableWidget`（行级解析器 + 内联渲染纯函数）。列表通过专用 keymap（`Prec.highest`）+ 纯函数缩进逻辑 + 现成 `showToast`。代码块改为整块 `CodeBlockWidget`（highlight.js 着色 + 圆角容器 + 单块横向滚动），光标进入回退源码（与表格同型）。

**Tech Stack:** CodeMirror 6、`@codemirror/lang-markdown`、`@lezer/markdown`（GFM 扩展）、`highlight.js`（`lib/common` + `github.css`）、Vitest、Tauri 2、Vanilla TS。

## Global Constraints

- 缩进单位 = 4 个空格（`"    "`）。Tab 在任意行缩进 4 空格；列表行缩进即降级。
- 列表相邻项最多相差一级：`canDemote(prevDepth, curDepth)` 当 `prevDepth === null`（首项无前驱）或 `curDepth > prevDepth` 时为 false，弹 `showToast("列表相邻项最多相差一级")` 不缩进。
- Shift-Tab / 行首 Backspace 删一个 4 空格单元（逐级回升）。
- 代码块语言标签原样显示 info string，不首字母大写；无 info string 不显示。
- 代码块超长行横向滚动（`white-space: pre` + `overflow-x: auto`），不折行。
- 新样式放 `src/note/preview.ts` 的 `previewTheme`（`EditorView.theme`），不进 `src/styles.css`（沿用现状约定）。
- 代码风格：2 空格缩进、双引号、分号、camelCase（与现有 `src/note/` 一致）。
- 跨平台：纯前端/CSS，无平台 API；macOS 与 Windows 表现应一致。
- 不引入 `@codemirror/language-data`、prism、shiki、marked、markdown-it。

---

## File Structure

- **Create** `src/note/table.ts` — 纯函数 `parseGfmTable(src)`：解析 GFM 表格为 `{ aligns, header, rows }`。
- **Create** `src/note/table.test.ts` — `parseGfmTable` 的 Vitest。
- **Create** `src/note/inline.ts` — 纯函数 `renderInline(text)`：用 `markdownLanguage.parser` 把内联 markdown 渲染成 HTML。
- **Create** `src/note/inline.test.ts` — `renderInline` 的 Vitest。
- **Create** `src/note/list-indent.ts` — 纯函数：`isListItemLine`、`lineDepth`、`indentLine`、`outdentLine`、`canDemote`、`prevListItemDepth`。
- **Create** `src/note/list-indent.test.ts` — 上述纯函数的 Vitest。
- **Create** `src/note/list-keymap.ts` — `listKeymap(): Extension`：Tab / Shift-Tab / Backspace / Enter 绑定（`Prec.highest`），调用 list-indent 纯函数 + `showToast`。
- **Modify** `src/note/editor.ts` — `markdown({ extensions: [Table, Strikethrough, TaskList] })`；挂载 `listKeymap()`。
- **Modify** `src/note/preview.ts` — 升级 `TableWidget`（用 `parseGfmTable` + `renderInline`）；新增 `CodeBlockWidget` 并重写 `FencedCode` 分支；`previewTheme` 增代码块样式。
- **Modify** `src/note/main.ts` — `import "highlight.js/styles/github.css"`（hljs 主题）。
- **Modify** `package.json` — 新增 `@lezer/markdown`、`highlight.js`。

---

### Task 1: 安装依赖 + 启用 GFM（表格/任务/删除线开始渲染）

**Files:**
- Modify: `package.json`
- Modify: `src/note/editor.ts:2,51`

**Interfaces:**
- Consumes: 无
- Produces: `markdown()` 启用 GFM，使 Lezer 产出 `Table`/`TaskMarker`/`StrikethroughMark` 节点，供后续 `preview.ts` 的 `case` 分支消费。

- [ ] **Step 1: 安装依赖**

```bash
npm install @lezer/markdown highlight.js
```

Expected: `package.json` 的 `dependencies` 出现 `@lezer/markdown` 与 `highlight.js`。

- [ ] **Step 2: 在 `editor.ts` 引入 GFM 扩展并配置 `markdown()`**

修改 `src/note/editor.ts`：在 `import { markdown } from "@codemirror/lang-markdown";`（第 2 行）下方新增一行导入：

```ts
import { Strikethrough, Table, TaskList } from "@lezer/markdown";
```

把第 51 行 `markdown(),` 改为：

```ts
markdown({ extensions: [Table, Strikethrough, TaskList] }),
```

- [ ] **Step 3: 跑既有测试作回归**

Run: `npm test`
Expected: PASS（`preview.test.ts` 只测 `iconCacheStateKey`/`rangeTouchesSelection`/`shouldRetryMissingIcon` 纯函数，不受 GFM 影响；全部既有测试通过）。

- [ ] **Step 4: 类型检查 + 构建**

Run: `npm run build`
Expected: `tsc` 与 `vite build` 均通过，无类型错误。

- [ ] **Step 5: 手动冒烟（macOS）**

Run: `npm run tauri dev`
在笔记里写入一个 GFM 表格：
```
| a | b |
| --- | ---: |
| 1 | 2 |
```
Expected: 表格被 `TableWidget` 渲染成 HTML 表格（此时仍是旧 `TableWidget` 的纯文本/无对齐版本——Task 4 会升级）。再确认 `- [ ]` 任务项出现 checkbox、`~~x~~` 删除线生效。

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/note/editor.ts
git commit -m "feat(note): enable GFM tables/strikethrough/tasklist in markdown parser"
```

---

### Task 2: `parseGfmTable` 纯函数（TDD）

**Files:**
- Create: `src/note/table.ts`
- Test: `src/note/table.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `parseGfmTable(src: string): ParsedTable | null`，其中 `ParsedTable = { aligns: ("left"|"right"|"center"|"none")[]; header: string[]; rows: string[][] }`。`null` 表示不是合法 GFM 表格（缺分隔行）。

- [ ] **Step 1: 写失败测试**

创建 `src/note/table.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { parseGfmTable } from "./table";

describe("parseGfmTable", () => {
  it("parses a basic 2-col table with no alignment", () => {
    const src = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const t = parseGfmTable(src);
    expect(t).not.toBeNull();
    expect(t!.header).toEqual(["a", "b"]);
    expect(t!.rows).toEqual([["1", "2"]]);
    expect(t!.aligns).toEqual(["none", "none"]);
  });

  it("parses left / right / center alignment from the delimiter row", () => {
    const src = "| a | b | c |\n| :--- | ---: | :---: |\n| 1 | 2 | 3 |";
    const t = parseGfmTable(src);
    expect(t!.aligns).toEqual(["left", "right", "center"]);
  });

  it("returns null when the second row is not a delimiter", () => {
    const src = "| a | b |\n| 1 | 2 |";
    expect(parseGfmTable(src)).toBeNull();
  });

  it("handles rows without leading/trailing pipes", () => {
    const src = "a | b\n--- | ---\n1 | 2";
    const t = parseGfmTable(src);
    expect(t!.header).toEqual(["a", "b"]);
    expect(t!.rows).toEqual([["1", "2"]]);
  });

  it("handles empty cells and extra trailing pipe", () => {
    const src = "| a | b |\n| --- | --- |\n|  |  |";
    const t = parseGfmTable(src);
    expect(t!.rows).toEqual([["", ""]]);
  });

  it("ignores leading/trailing blank lines", () => {
    const src = "\n| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    const t = parseGfmTable(src);
    expect(t!.header).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/note/table.test.ts`
Expected: FAIL，报错 `parseGfmTable is not defined` / 模块不存在。

- [ ] **Step 3: 写最小实现**

创建 `src/note/table.ts`：

```ts
export type Align = "left" | "right" | "center" | "none";

export interface ParsedTable {
  aligns: Align[];
  header: string[];
  rows: string[][];
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

function parseAlign(cell: string): Align {
  const t = cell.trim();
  const left = t.startsWith(":");
  const right = t.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

function isDelimiter(cell: string): boolean {
  return /^:?-+:?$/.test(cell.trim());
}

/** Parse a GFM pipe table. Returns null if `src` is not a valid table
 *  (e.g. missing the delimiter row). Does not support escaped `\|`. */
export function parseGfmTable(src: string): ParsedTable | null {
  const lines = src.trim().split("\n").map((l) => l.trim());
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]);
  const delim = splitRow(lines[1]);
  if (!delim.every(isDelimiter)) return null;
  const aligns = delim.map(parseAlign);
  const rows = lines.slice(2).map(splitRow);
  return { aligns, header, rows };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/note/table.test.ts`
Expected: PASS（6 条全过）。

- [ ] **Step 5: Commit**

```bash
git add src/note/table.ts src/note/table.test.ts
git commit -m "feat(note): add parseGfmTable pure parser with alignment"
```

---

### Task 3: `renderInline` 纯函数（TDD）

**Files:**
- Create: `src/note/inline.ts`
- Test: `src/note/inline.test.ts`

**Interfaces:**
- Consumes: `markdownLanguage`（`@codemirror/lang-markdown`）、`Strikethrough`（`@lezer/markdown`）
- Produces: `renderInline(text: string): string` — 把内联 markdown 渲染成已转义、只含已知标签的 HTML 片段。供 `TableWidget` 单元格 `innerHTML` 使用。

- [ ] **Step 1: 写失败测试**

创建 `src/note/inline.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { renderInline } from "./inline";

describe("renderInline", () => {
  it("renders bold", () => {
    expect(renderInline("**bold**")).toBe("<strong>bold</strong>");
  });

  it("renders emphasis", () => {
    expect(renderInline("*em*")).toBe("<em>em</em>");
  });

  it("renders inline code, escaping inner characters", () => {
    expect(renderInline("`a < b`")).toBe("<code>a &lt; b</code>");
  });

  it("renders a link with escaped url/label", () => {
    expect(renderInline("[t](http://u/x)")).toBe('<a href="http://u/x">t</a>');
  });

  it("renders strikethrough", () => {
    expect(renderInline("~~s~~")).toBe("<del>s</del>");
  });

  it("escapes plain text with HTML-significant characters", () => {
    expect(renderInline("a & b <c>")).toBe("a &amp; b &lt;c&gt;");
  });

  it("renders nested emphasis inside strong", () => {
    expect(renderInline("**a *b***")).toBe("<strong>a <em>b</em></strong>");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/note/inline.test.ts`
Expected: FAIL，`renderInline is not defined`。

- [ ] **Step 3: 写最小实现**

创建 `src/note/inline.ts`：

```ts
import { markdownLanguage } from "@codemirror/lang-markdown";
import { Strikethrough } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";

// Configure a parser that also understands ~~strike~~ so strikethrough in
// table cells parses the same way it does in the editor (GFM enabled in
// editor.ts). `markdownLanguage.parser` is the MarkdownParser from Lezer.
const inlineParser = markdownLanguage.parser.configure({
  extensions: [Strikethrough],
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderChildren(node: SyntaxNode, text: string): string {
  let out = "";
  for (let c = node.firstChild; c; c = c.nextSibling) out += renderNode(c, text);
  return out;
}

function renderNode(node: SyntaxNode, text: string): string {
  switch (node.name) {
    // Structural marks: their text is part of the syntax, not content.
    case "EmphasisMark":
    case "StrikethroughMark":
    case "CodeMark":
    case "LinkMark":
      return "";
    case "Document":
    case "Paragraph":
      return renderChildren(node, text);
    case "Strong":
      return `<strong>${renderChildren(node, text)}</strong>`;
    case "Emphasis":
      return `<em>${renderChildren(node, text)}</em>`;
    case "Strikethrough":
      return `<del>${renderChildren(node, text)}</del>`;
    case "InlineCode": {
      const raw = text.slice(node.from, node.to);
      const code = raw.replace(/^`+|`+$/g, "");
      return `<code>${escapeHtml(code)}</code>`;
    }
    case "Link": {
      const raw = text.slice(node.from, node.to);
      const m = /^\[([\s\S]*)\]\(([\s\S]*)\)$/.exec(raw);
      if (m) return `<a href="${escapeHtml(m[2].trim())}">${renderInline(m[1])}</a>`;
      return escapeHtml(raw);
    }
    case "Escape": {
      // backslash escape: emit the escaped character itself, escaped for HTML.
      const raw = text.slice(node.from, node.to);
      const ch = raw.replace(/^\\/, "");
      return escapeHtml(ch);
    }
    default:
      if (node.firstChild) return renderChildren(node, text);
      return escapeHtml(text.slice(node.from, node.to));
  }
}

/** Render a snippet of inline markdown to an HTML string. Text is HTML-escaped;
 *  only a known set of inline tags is emitted, so the result is safe for
 *  `innerHTML` in table cells. */
export function renderInline(text: string): string {
  const tree = inlineParser.parse(text);
  return renderNode(tree.topNode, text);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/note/inline.test.ts`
Expected: PASS（7 条全过）。若 `*em*` 未解析成 `<em>`（某些 Lezer 版本默认 `*` 与 `_` 均为 Emphasis），检查实际输出并据此调整断言或实现；预期默认即支持。

- [ ] **Step 5: Commit**

```bash
git add src/note/inline.ts src/note/inline.test.ts
git commit -m "feat(note): add renderInline pure renderer via lezer markdown"
```

---

### Task 4: 升级 `TableWidget`（对齐 + 单元格内联）

**Files:**
- Modify: `src/note/preview.ts:130-154`（`TableWidget` 类）
- Modify: `src/note/preview.ts:12`（新增 import）

**Interfaces:**
- Consumes: `parseGfmTable`（Task 2）、`renderInline`（Task 3）
- Produces: 表格渲染支持列对齐 + 单元格内联 markdown。

- [ ] **Step 1: 引入纯函数**

在 `src/note/preview.ts` 顶部 import 区（第 12 行 `import { ... } from "./quote";` 附近）新增：

```ts
import { renderInline } from "./inline";
import { parseGfmTable, type Align } from "./table";
```

- [ ] **Step 2: 重写 `TableWidget.toDOM`**

把 `src/note/preview.ts` 第 130-154 行的 `TableWidget` 类整体替换为：

```ts
class TableWidget extends WidgetType {
  constructor(readonly src: string) { super(); }
  eq(o: TableWidget): boolean { return o.src === this.src; }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-preview-table-wrap";
    const parsed = parseGfmTable(this.src);
    if (!parsed) { wrap.textContent = this.src; return wrap; }
    const table = document.createElement("table");
    table.className = "cm-preview-table";
    const alignStyle = (a: Align): string => (a === "none" ? "" : a);

    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    parsed.header.forEach((cell, i) => {
      const th = document.createElement("th");
      th.innerHTML = renderInline(cell);
      th.style.textAlign = alignStyle(parsed.aligns[i] ?? "none");
      htr.appendChild(th);
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of parsed.rows) {
      const tr = document.createElement("tr");
      row.forEach((cell, i) => {
        const td = document.createElement("td");
        td.innerHTML = renderInline(cell);
        td.style.textAlign = alignStyle(parsed.aligns[i] ?? "none");
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent() { return true; }
}
```

- [ ] **Step 3: 跑测试作回归**

Run: `npm test`
Expected: PASS（既有测试不受影响；`parseGfmTable`/`renderInline` 单测全过）。

- [ ] **Step 4: 类型检查 + 构建**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 5: 手动验证（macOS）**

Run: `npm run tauri dev`
写入：
```
| 名称 | 分数 | 备注 |
| :--- | ---: | :---: |
| **甲** | 1 | [l](http://x) |
| 乙 | 2 | `c` |
```
Expected: 表格渲染，首列左对齐、次列右对齐、末列居中；单元格内 `**甲**`、`[l](http://x)`、`` `c` `` 均渲染。光标进入表格任意行回退源码。

- [ ] **Step 6: Commit**

```bash
git add src/note/preview.ts
git commit -m "feat(note): table widget with alignment + inline cell rendering"
```

---

### Task 5: `list-indent.ts` 纯函数（TDD）

**Files:**
- Create: `src/note/list-indent.ts`
- Test: `src/note/list-indent.test.ts`

**Interfaces:**
- Consumes: 无
- Produces:
  - `isListItemLine(line: string): boolean`
  - `lineDepth(line: string): number`（前导空格数 / 4 向下取整；4 空格 = 一级）
  - `indentLine(line: string): string`（行首加 4 空格）
  - `outdentLine(line: string): string`（行首删最多 4 个前导空格；不足则删到行首；`\t` 按 1 删）
  - `canDemote(prevDepth: number | null, curDepth: number): boolean`
  - `prevListItemDepth(lines: string[], index: number): number | null`（`index` 为当前行 0 基下标；向上扫描，跳过空行，遇列表行返回其 `lineDepth`，遇非空非列表行返回 `null`，到顶返回 `null`）

- [ ] **Step 1: 写失败测试**

创建 `src/note/list-indent.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  canDemote,
  indentLine,
  isListItemLine,
  lineDepth,
  outdentLine,
  prevListItemDepth,
} from "./list-indent";

describe("isListItemLine", () => {
  it("matches unordered and ordered markers", () => {
    expect(isListItemLine("- a")).toBe(true);
    expect(isListItemLine("* a")).toBe(true);
    expect(isListItemLine("+ a")).toBe(true);
    expect(isListItemLine("1. a")).toBe(true);
    expect(isListItemLine("  - a")).toBe(true);
  });
  it("rejects plain and empty lines", () => {
    expect(isListItemLine("plain")).toBe(false);
    expect(isListItemLine("")).toBe(false);
    expect(isListItemLine("    ")).toBe(false);
  });
});

describe("lineDepth", () => {
  it("counts 4 spaces per level", () => {
    expect(lineDepth("- a")).toBe(0);
    expect(lineDepth("    - a")).toBe(1);
    expect(lineDepth("        - a")).toBe(2);
  });
  it("floors sub-level indent", () => {
    expect(lineDepth("  - a")).toBe(0);
  });
});

describe("indentLine / outdentLine", () => {
  it("indent adds 4 spaces", () => {
    expect(indentLine("- a")).toBe("    - a");
  });
  it("outdent removes up to 4 leading spaces", () => {
    expect(outdentLine("    - a")).toBe("- a");
    expect(outdentLine("        - a")).toBe("    - a");
  });
  it("outdent removes a tab too", () => {
    expect(outdentLine("\t- a")).toBe("- a");
  });
  it("outdent on no leading whitespace is a no-op", () => {
    expect(outdentLine("- a")).toBe("- a");
  });
  it("outdent removes only what is there", () => {
    expect(outdentLine("  - a")).toBe("- a");
  });
});

describe("canDemote", () => {
  it("allows when current is at or above previous", () => {
    expect(canDemote(0, 0)).toBe(true);
    expect(canDemote(1, 1)).toBe(true);
    expect(canDemote(2, 1)).toBe(true);
  });
  it("forbids when already one level below previous", () => {
    expect(canDemote(0, 1)).toBe(false);
    expect(canDemote(1, 2)).toBe(false);
  });
  it("forbids the first item (no previous)", () => {
    expect(canDemote(null, 0)).toBe(false);
  });
});

describe("prevListItemDepth", () => {
  const lines = ["- a", "    - b", "- c", "", "- d"];
  it("returns the previous list line's depth", () => {
    expect(prevListItemDepth(lines, 1)).toBe(0); // prev "- a" depth 0
    expect(prevListItemDepth(lines, 2)).toBe(1); // prev "    - b" depth 1
  });
  it("skips a blank line", () => {
    expect(prevListItemDepth(lines, 4)).toBe(0); // prev (skip blank) "- c" depth 0
  });
  it("returns null when a non-list non-blank line blocks", () => {
    expect(prevListItemDepth(["plain", "- a"], 1)).toBe(null);
  });
  it("returns null at the top", () => {
    expect(prevListItemDepth(["- a"], 0)).toBe(null);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/note/list-indent.test.ts`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 写最小实现**

创建 `src/note/list-indent.ts`：

```ts
const INDENT = "    "; // 4 spaces

export function isListItemLine(line: string): boolean {
  return /^\s*([-*+]|\d+\.)\s/.test(line);
}

/** Nesting depth in 4-space units. Our Tab inserts 4 spaces per level, so
 *  user-created nesting is always a multiple of 4. */
export function lineDepth(line: string): number {
  const m = /^(\s*)/.exec(line);
  return Math.floor((m ? m[1].length : 0) / 4);
}

export function indentLine(line: string): string {
  return INDENT + line;
}

export function outdentLine(line: string): string {
  const spaces = /^ {1,4}/.exec(line);
  if (spaces) return line.slice(spaces[0].length);
  if (/^\t/.test(line)) return line.slice(1);
  return line;
}

/** Whether Tab may demote the current item, given the immediately preceding
 *  list item's depth (null = first item, no predecessor). Allowed only when
 *  the result would be at most one level deeper than the predecessor. */
export function canDemote(prevDepth: number | null, curDepth: number): boolean {
  if (prevDepth === null) return false;
  return curDepth <= prevDepth;
}

/** Depth of the nearest preceding list line. `index` is the current line's
 *  0-based index. Skips blank lines; returns null if a non-blank non-list line
 *  is hit first, or at the top of the document. */
export function prevListItemDepth(lines: string[], index: number): number | null {
  for (let i = index - 1; i >= 0; i--) {
    const t = lines[i];
    if (t.trim() === "") continue;
    if (isListItemLine(t)) return lineDepth(t);
    return null;
  }
  return null;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/note/list-indent.test.ts`
Expected: PASS（全过）。

- [ ] **Step 5: Commit**

```bash
git add src/note/list-indent.ts src/note/list-indent.test.ts
git commit -m "feat(note): add list indent/outdent pure helpers with depth cap"
```

---

### Task 6: `list-keymap.ts` — Tab / Shift-Tab / Backspace / Enter

**Files:**
- Create: `src/note/list-keymap.ts`
- Modify: `src/note/editor.ts:7,53`（import + 挂载）

**Interfaces:**
- Consumes: `list-indent.ts` 全部纯函数（Task 5）、`showToast`（`src/shared/toast.ts`）、`insertNewlineContinueMarkup`（`@codemirror/lang-markdown`）
- Produces: `listKeymap(): Extension`，由 `editor.ts` 挂载。

- [ ] **Step 1: 创建 keymap 模块**

创建 `src/note/list-keymap.ts`：

```ts
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { Prec, type Extension } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { showToast } from "../shared/toast";
import {
  canDemote,
  indentLine,
  isListItemLine,
  lineDepth,
  outdentLine,
  prevListItemDepth,
} from "./list-indent";

const INDENT = "    ";
const CAP_MSG = "列表相邻项最多相差一级";

/** All line texts as a 0-based array, for prevListItemDepth. */
function docLines(doc: { line(n: number): { text: string }; lines: number }): string[] {
  const out: string[] = [];
  for (let i = 1; i <= doc.lines; i++) out.push(doc.line(i).text);
  return out;
}

/** Tab: indent any line by 4 spaces (list lines demote, subject to the
 *  one-level cap). Multi-character selections fall through to the default. */
function handleTab(view: { state: any; dispatch: (spec: any) => void }): boolean {
  const state = view.state;
  const sel = state.selection.main;
  if (sel.from !== sel.to) return false;
  const line = state.doc.lineAt(sel.from);
  if (isListItemLine(line.text)) {
    const curDepth = lineDepth(line.text);
    const prevDepth = prevListItemDepth(docLines(state.doc), line.number - 1);
    if (!canDemote(prevDepth, curDepth)) {
      showToast(CAP_MSG);
      return true;
    }
  }
  view.dispatch({
    changes: { from: line.from, insert: INDENT },
    selection: { anchor: sel.from + INDENT.length },
    scrollIntoView: true,
  });
  return true;
}

/** Shift-Tab: remove one 4-space unit from the line start. */
function handleOutdent(view: { state: any; dispatch: (spec: any) => void }): boolean {
  const state = view.state;
  const sel = state.selection.main;
  if (sel.from !== sel.to) return false;
  const line = state.doc.lineAt(sel.from);
  if (!/^\s/.test(line.text)) return false;
  const before = outdentLine(line.text);
  const removed = line.text.length - before.length;
  if (removed === 0) return false;
  view.dispatch({
    changes: { from: line.from, to: line.from + removed, insert: "" },
    selection: { anchor: Math.max(line.from, sel.from - removed) },
  });
  return true;
}

/** Backspace at column 0: remove one indent unit. No indent (empty list item)
 *  → return false so markdownKeymap's deleteMarkupBackward removes the marker. */
function handleBackspace(view: { state: any; dispatch: (spec: any) => void }): boolean {
  const state = view.state;
  const sel = state.selection.main;
  if (sel.from !== sel.to) return false;
  const line = state.doc.lineAt(sel.from);
  if (sel.from !== line.from) return false;
  if (!/^\s/.test(line.text)) return false;
  const before = outdentLine(line.text);
  const removed = line.text.length - before.length;
  if (removed === 0) return false;
  view.dispatch({
    changes: { from: line.from, to: line.from + removed, insert: "" },
    selection: { anchor: line.from },
  });
  return true;
}

export function listKeymap(): Extension {
  return Prec.highest(
    keymap.of([
      { key: "Tab", run: handleTab },
      { key: "Shift-Tab", run: handleOutdent },
      { key: "Backspace", run: handleBackspace },
      // insertNewlineContinueMarkup returns false on non-markup lines, so the
      // default Enter (insertNewlineAndIndent) still runs there. On list lines
      // it continues the marker; on an empty list item it exits the list.
      { key: "Enter", run: insertNewlineContinueMarkup },
    ]),
  );
}
```

- [ ] **Step 2: 在 `editor.ts` 引入并挂载**

修改 `src/note/editor.ts`：在第 7 行 `import { livePreview } from "./preview";` 后新增：

```ts
import { listKeymap } from "./list-keymap";
```

在 `createEditor` 的 extensions 数组里（第 53 行 `...livePreview(),` 之后）新增一项：

```ts
listKeymap(),
```

- [ ] **Step 3: 类型检查 + 构建**

Run: `npm run build`
Expected: 通过（`any` 用于 view/state 以避免引入大量类型；若 tsc 严格报错，把 `view` 参数类型改为 `import("@codemirror/view").EditorView`、`state` 用 `import("@codemirror/state").EditorState`）。

- [ ] **Step 4: 跑既有测试作回归**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: 手动验证（macOS）**

Run: `npm run tauri dev`
验证清单：
- 输入 `- a`，光标在该行按 Tab → 变 `    - a`（降级）；Shift-Tab → 回 `- a`。
- `1. a` 同理。
- `- a` 下一行 Enter → 自动续 `- `；空项再 Enter → 退出列表。
- 普通段落行按 Tab → 行首加 4 空格。
- `- a`（depth0）→ Tab 到 depth1 → 再按 Tab：不缩进，底部弹出 toast「列表相邻项最多相差一级」。
- 行首 Backspace：`    - a` → `- a`；`- a`（空项 `- `）行首 Backspace → 删标记（由 deleteMarkupBackward 处理）。

- [ ] **Step 6: Commit**

```bash
git add src/note/list-keymap.ts src/note/editor.ts
git commit -m "feat(note): list tab/shift-tab/backspace/enter keymap with depth cap"
```

---

### Task 7: `CodeBlockWidget` + highlight.js（圆角 / 语言标签 / 横向滚动 / 高亮）

**Files:**
- Modify: `src/note/preview.ts:524-561`（`FencedCode` 分支）
- Modify: `src/note/preview.ts`（新增 `CodeBlockWidget` 类 + import）
- Modify: `src/note/preview.ts:766-773`（`previewTheme` 代码块样式）
- Modify: `src/note/main.ts`（顶部 import hljs 主题 CSS）

**Interfaces:**
- Consumes: `highlight.js/lib/common`（`hljs`）
- Produces: `FencedCode` 整块渲染为带高亮、圆角、语言标签、横向滚动的 `<div.cm-codeblock>`；光标进入块回退源码。

- [ ] **Step 1: 在 `main.ts` 引入 hljs 主题 CSS**

在 `src/note/main.ts` 顶部 import 区新增（位置与其他样式 import 一致；若无样式 import 则置于模块顶部）：

```ts
import "highlight.js/styles/github.css";
```

- [ ] **Step 2: 在 `preview.ts` 引入 hljs**

在 `src/note/preview.ts` 顶部 import 区新增：

```ts
import hljs from "highlight.js/lib/common";
```

- [ ] **Step 3: 新增 `CodeBlockWidget` 类**

在 `src/note/preview.ts` 的 `TableWidget` 类之后（约第 155 行前）新增：

```ts
class CodeBlockWidget extends WidgetType {
  constructor(readonly code: string, readonly lang: string) { super(); }
  eq(o: CodeBlockWidget): boolean {
    return o.code === this.code && o.lang === this.lang;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-codeblock";

    if (this.lang) {
      const label = document.createElement("span");
      label.className = "cm-code-lang";
      label.textContent = this.lang;
      wrap.appendChild(label);
    }

    const pre = document.createElement("pre");
    const codeEl = document.createElement("code");
    codeEl.className = "hljs";
    try {
      const html = this.lang && hljs.getLanguage(this.lang)
        ? hljs.highlight(this.code, { language: this.lang }).value
        : hljs.highlightAuto(this.code).value;
      codeEl.innerHTML = html;
    } catch {
      codeEl.textContent = this.code;
    }
    pre.appendChild(codeEl);
    wrap.appendChild(pre);
    return wrap;
  }
  ignoreEvent() { return true; }
}
```

- [ ] **Step 4: 重写 `FencedCode` 分支为整块 widget**

把 `src/note/preview.ts` 第 524-561 行 `case "FencedCode": { ... }` 整体替换为：

```ts
        case "FencedCode": {
          // Block-level: reveal the whole block (fences + source) when the
          // cursor is on any of its lines, like Table. Otherwise render the
          // whole block as a single highlighted <pre> widget.
          const fromLine = doc.lineAt(node.from).number;
          const toLine = doc.lineAt(node.to).number;
          for (let l = fromLine; l <= toLine; l++) {
            if (cursorLines.has(l)) return false;
          }
          const firstLine = doc.line(fromLine).text;
          const lang = (/^[ \t]*```[ \t]*(\S*)/.exec(firstLine)?.[1] ?? "").toLowerCase();
          // Body = lines strictly between the fences (drop first & last line).
          const body = doc.sliceString(
            doc.line(fromLine + 1).from,
            doc.line(toLine - 1).to,
          );
          entries.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({
              widget: new CodeBlockWidget(body, lang),
              block: true,
            }),
          });
          return false;
        }
```

注意：此分支假定 fenced 块至少 3 行（开围栏 + 内容 + 闭围栏）。空块（开/闭同处两行、无内容）时 `fromLine + 1` 可能越界；若手动测试出现空代码块崩溃，改用 `body = fromLine + 1 <= toLine - 1 ? doc.sliceString(doc.line(fromLine+1).from, doc.line(toLine-1).to) : ""`。

- [ ] **Step 5: 更新 `previewTheme` 代码块样式**

把 `src/note/preview.ts` 第 766-773 行的 `".cm-preview-codeblock"` 规则整块替换为：

```ts
  ".cm-codeblock": {
    position: "relative",
    background: "rgba(0,0,0,0.05)",
    borderRadius: "8px",
    margin: "4px 0",
    overflow: "hidden",
  },
  ".cm-codeblock:hover": {
    background: "rgba(0,0,0,0.08)",
  },
  ".cm-codeblock pre": {
    margin: "0",
    padding: "10px 12px",
    overflowX: "auto",
  },
  ".cm-codeblock code": {
    fontFamily: "ui-monospace, 'SF Mono', monospace",
    fontSize: "0.9em",
    background: "transparent",
    whiteSpace: "pre",
  },
  ".cm-codeblock .hljs": {
    background: "transparent",
  },
  ".cm-code-lang": {
    position: "absolute",
    top: "4px",
    right: "8px",
    fontSize: "0.75em",
    color: "rgba(0,0,0,0.35)",
    fontFamily: "ui-monospace, 'SF Mono', monospace",
    pointerEvents: "none",
  },
  ".cm-codeblock:hover .cm-code-lang": {
    color: "rgba(0,0,0,0.6)",
  },
```

- [ ] **Step 6: 类型检查 + 构建**

Run: `npm run build`
Expected: 通过。若 `@codemirror/view` 的 `EditorView.theme` 不接受某些 CSS 属性名（如 `overflowX`），改用字符串键 `"overflow-x"` 形式（theme 接受 camelCase；若报错则参考既有 `whiteSpace` 用法）。

- [ ] **Step 7: 手动验证（macOS）**

Run: `npm run tauri dev`
写入：
````markdown
```python
def f(x):
    return x * 2  # a very long line that should scroll horizontally instead of wrapping, and keep going past the right edge
```
````
验证：圆角浅灰背景；右上角显示 `python`；代码按 Python 语法高亮；超长行出现横向滚动条、不折行；hover 背景略加深、标签提亮；光标进入块回退原始 ```` ``` ```` 源码。再试无 info string 的 ```` ``` ```` 块（无标签、`highlightAuto` 着色）。

- [ ] **Step 8: Commit**

```bash
git add src/note/preview.ts src/note/main.ts
git commit -m "feat(note): code block widget with highlight.js, rounded corners, lang label, horizontal scroll"
```

---

### Task 8: 最终验证（测试 / 类型 / 跨平台手动）

**Files:** 无（仅验证）

- [ ] **Step 1: 全量测试**

Run: `npm test`
Expected: 全部 PASS（新增 `table.test.ts`、`inline.test.ts`、`list-indent.test.ts` + 既有测试）。

- [ ] **Step 2: 类型 + 构建**

Run: `npm run build`
Expected: `tsc` + `vite build` 通过。

- [ ] **Step 3: macOS 端到端**

Run: `npm run tauri dev`
按 Task 1/4/6/7 的手动清单逐项复核：表格（对齐+内联）、列表（Tab/Shift-Tab/Enter/Backspace/上限提示+toast）、代码块（高亮+圆角+标签+横向滚动+hover+聚焦回退）。

- [ ] **Step 4: Windows 复核（如可行）**

在 Windows 上 `npm run tauri dev`，重点验证代码块横向滚动条与 toast 在 Windows 表现正常。无平台 API，预期一致。

- [ ] **Step 5: 收尾提交（若有验证修复）**

```bash
git status
# 若有改动：
git add -A && git commit -m "fix(note): polish from end-to-end verification"
# 若无改动：跳过
```

---

## Self-Review

**1. Spec coverage:**
- 表格渲染（spec 5.1）：Task 1（GFM 启用）+ Task 2（解析）+ Task 3（内联）+ Task 4（TableWidget 升级）。✓
- 列表 Tab/Shift-Tab/Enter/Backspace + 相邻项上限 + toast（spec 5.2）：Task 5（纯函数）+ Task 6（keymap）。✓
- 代码块 highlight.js 高亮（spec 5.3）：Task 7（CodeBlockWidget + hljs）。✓
- 代码块圆角/浅灰背景/语言标签/横向滚动/hover（spec 5.4）：Task 7（样式 + widget）。✓
- 缩进 4 空格、任意行可缩进、语言标签原样：Global Constraints + Task 5/6/7。✓
- 依赖 `@lezer/markdown`、`highlight.js`（spec 7）：Task 1。✓
- 测试（spec 6）：Task 2/3/5 单测 + Task 8 全量 + 手动。✓

**2. Placeholder scan:** 无 TBD/TODO；每步含实代码或实命令。Task 7 Step 4 含一处空块边界防护注释（已给替代写法），非占位。✓

**3. Type consistency:** `parseGfmTable`/`ParsedTable`/`Align`（Task 2）↔ Task 4 `import { parseGfmTable, type Align }` 一致；`renderInline`（Task 3）↔ Task 4 一致；`list-indent` 六函数签名（Task 5）↔ Task 6 import 一致；`CodeBlockWidget(code, lang)`（Task 7）↔ `new CodeBlockWidget(body, lang)` 一致。✓
