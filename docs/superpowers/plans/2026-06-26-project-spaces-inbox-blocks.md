# Project Spaces — Plan 3: Inbox Block View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the current project's `_inbox.md` as a lightweight stack of block cards (clip callouts / todos / free text) with hover handles for drag-reorder + delete and a todo checkbox toggle, plus a topbar toggle to drop back to raw Markdown source.

**Architecture:** The CodeMirror doc stays the single source of truth for `_inbox.md`. The block view is a pure *render-and-manipulate layer* over that doc: it parses the markdown into blocks, renders cards, and commits edits by rewriting the whole doc through the existing `setDoc` → autosave path. This keeps the assistant's `noteText`, autosave, and version snapshots working untouched. All parsing/serialization/reordering logic lives in pure, Vitest-tested helpers; only the thin DOM view is verified manually.

**Tech Stack:** TypeScript + Vite, CodeMirror (already mounted), native Pointer Events for drag (no new dependency), Vitest (node env) for the pure helpers.

---

## Scope & Non-Goals (this plan only)

In scope: parse `_inbox.md` → top-level blocks; render callout / quote / todo / text cards; hover handle → pointer-drag reorder; delete button; todo checkbox toggle (writes `- [x]`); serialize back to Markdown losslessly; a block↔source toggle in the topbar (source = the existing CodeMirror on the same file).

Out of scope (per spec "不做完整 Notion 块引擎" and the approved Plan-3 design): inline text editing of blocks (free-form edits go through the source toggle), slash menus, nesting/folding, columns, "add block" buttons, AI distillation, and rewiring capture to write callouts (capture stays a plain blockquote until Plan 7 — it still parses and renders fine as a `quote` card).

## Block model

```ts
type Block =
  | { kind: "todo"; checked: boolean; text: string }                         // - [ ] / - [x]  (one per line)
  | { kind: "callout"; calloutType: string; title: string; body: string[] }  // > [!quote] 来源  + > body lines
  | { kind: "quote"; lines: string[] }                                       // plain > blockquote
  | { kind: "text"; lines: string[] };                                       // paragraph / heading / anything else
```

Parse rules: normalize CRLF→LF; blank lines separate blocks; each `- [ ] `/`- [x] ` line is its own `todo` block; a run of consecutive `>`-prefixed lines is a `callout` (if its first line is `> [!type] title`) or a plain `quote`; any other run of consecutive non-blank lines is one `text` block. Serialize rules: join blocks with a blank line, except consecutive `todo` blocks join with a single newline so they stay one Markdown list (lossless for Obsidian).

## File Structure

- **Create** `src/note/blocks/parse.ts` — `Block` type, `parseBlocks`, `serializeBlocks`. Pure.
- **Create** `src/note/blocks/parse.test.ts` — Vitest for parse/serialize + round-trip.
- **Create** `src/note/blocks/ops.ts` — `moveBlock`, `removeBlock`, `toggleTodo`. Pure.
- **Create** `src/note/blocks/ops.test.ts` — Vitest for the three ops.
- **Create** `src/note/blocks/view.ts` — `createInboxView(parent, host)`: renders cards + wires handle drag / delete / checkbox; commits via `host.setDoc`.
- **Modify** `src/note/main.ts` — add `#text-col` wrapper + `#inbox-root`; mount the inbox view; `inboxMode` state; render on open / capture / agent-write; toggle wiring.
- **Modify** `src/note/topbar.ts` — add a source/block toggle button + `onToggleSource` callback + `setSourceToggle(mode)`.
- **Modify** `src/styles.css` — `#text-col` wrapper + block-mode visibility; card / handle / checkbox / drag styles (+ dark variants); toggle button.

---

## Task 1: Block parse + serialize (`blocks/parse.ts`)

**Files:**
- Create: `src/note/blocks/parse.ts`
- Test: `src/note/blocks/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/note/blocks/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseBlocks, serializeBlocks, type Block } from "./parse";

describe("parseBlocks", () => {
  it("parses an unchecked and a checked todo, one block per line", () => {
    expect(parseBlocks("- [ ] 待办一\n- [x] 待办二")).toEqual([
      { kind: "todo", checked: false, text: "待办一" },
      { kind: "todo", checked: true, text: "待办二" },
    ]);
  });

  it("parses a callout with a type, title and body", () => {
    expect(parseBlocks("> [!quote] 来源\n> 引用正文\n> 第二行")).toEqual([
      { kind: "callout", calloutType: "quote", title: "来源", body: ["引用正文", "第二行"] },
    ]);
  });

  it("parses a plain blockquote as a quote block", () => {
    expect(parseBlocks("> 普通引用\n> 第二行")).toEqual([
      { kind: "quote", lines: ["普通引用", "第二行"] },
    ]);
  });

  it("parses free text (incl. multi-line paragraphs) as a text block", () => {
    expect(parseBlocks("自由文本\n第二行文本")).toEqual([
      { kind: "text", lines: ["自由文本", "第二行文本"] },
    ]);
  });

  it("splits adjacent kinds even without a blank line between them", () => {
    expect(parseBlocks("段落\n- [ ] 待办")).toEqual([
      { kind: "text", lines: ["段落"] },
      { kind: "todo", checked: false, text: "待办" },
    ]);
  });

  it("normalizes CRLF and ignores blank-line separators", () => {
    expect(parseBlocks("a\r\n\r\n\r\nb")).toEqual([
      { kind: "text", lines: ["a"] },
      { kind: "text", lines: ["b"] },
    ]);
  });
});

describe("serializeBlocks", () => {
  it("keeps consecutive todos in one list and blank-separates other blocks", () => {
    const blocks: Block[] = [
      { kind: "callout", calloutType: "quote", title: "来源", body: ["引用正文"] },
      { kind: "todo", checked: false, text: "待办一" },
      { kind: "todo", checked: true, text: "待办二" },
      { kind: "text", lines: ["自由文本"] },
    ];
    expect(serializeBlocks(blocks)).toBe(
      "> [!quote] 来源\n> 引用正文\n\n- [ ] 待办一\n- [x] 待办二\n\n自由文本",
    );
  });

  it("serializes an empty todo without a trailing space", () => {
    expect(serializeBlocks([{ kind: "todo", checked: false, text: "" }])).toBe("- [ ]");
  });

  it("round-trips a mixed document", () => {
    const md =
      "> [!quote] 来源\n> 引用正文\n> 第二行\n\n- [ ] 待办一\n- [x] 待办二\n\n自由文本\n第二行文本";
    expect(serializeBlocks(parseBlocks(md))).toBe(md);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- blocks/parse`
Expected: FAIL — `./parse` cannot be resolved.

- [ ] **Step 3: Implement `parse.ts`**

Create `src/note/blocks/parse.ts`:

```ts
export type Block =
  | { kind: "todo"; checked: boolean; text: string }
  | { kind: "callout"; calloutType: string; title: string; body: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "text"; lines: string[] };

const TODO_RE = /^- \[([ xX])\](?: (.*))?$/;
const CALLOUT_RE = /^>\s*\[!(\w+)\]\s?(.*)$/;

/** Strip one leading `>` and an optional following space: "> a" → "a", ">" → "". */
function stripQuote(line: string): string {
  return line.replace(/^>\s?/, "");
}

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const todo = TODO_RE.exec(line);
    if (todo) {
      blocks.push({ kind: "todo", checked: todo[1] !== " ", text: todo[2] ?? "" });
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i]);
        i++;
      }
      const head = CALLOUT_RE.exec(quoteLines[0]);
      if (head) {
        blocks.push({
          kind: "callout",
          calloutType: head[1],
          title: head[2],
          body: quoteLines.slice(1).map(stripQuote),
        });
      } else {
        blocks.push({ kind: "quote", lines: quoteLines.map(stripQuote) });
      }
      continue;
    }

    const textLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith(">") &&
      !TODO_RE.test(lines[i])
    ) {
      textLines.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "text", lines: textLines });
  }

  return blocks;
}

/** Re-add the `>` prefix for a callout/quote body line. */
function reQuote(line: string): string {
  return line === "" ? ">" : `> ${line}`;
}

function blockToMarkdown(block: Block): string {
  switch (block.kind) {
    case "todo":
      return `- [${block.checked ? "x" : " "}]${block.text ? ` ${block.text}` : ""}`;
    case "callout": {
      const head = `> [!${block.calloutType}]${block.title ? ` ${block.title}` : ""}`;
      return [head, ...block.body.map(reQuote)].join("\n");
    }
    case "quote":
      return block.lines.map(reQuote).join("\n");
    case "text":
      return block.lines.join("\n");
  }
}

export function serializeBlocks(blocks: Block[]): string {
  let out = "";
  for (let i = 0; i < blocks.length; i++) {
    if (i === 0) {
      out += blockToMarkdown(blocks[i]);
      continue;
    }
    const adjacentTodos = blocks[i - 1].kind === "todo" && blocks[i].kind === "todo";
    out += (adjacentTodos ? "\n" : "\n\n") + blockToMarkdown(blocks[i]);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- blocks/parse`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/note/blocks/parse.ts src/note/blocks/parse.test.ts
git commit -m "feat(inbox): parse/serialize _inbox.md into blocks"
```

---

## Task 2: Block ops (`blocks/ops.ts`)

**Files:**
- Create: `src/note/blocks/ops.ts`
- Test: `src/note/blocks/ops.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/note/blocks/ops.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { moveBlock, removeBlock, toggleTodo } from "./ops";
import type { Block } from "./parse";

const a: Block = { kind: "text", lines: ["a"] };
const b: Block = { kind: "text", lines: ["b"] };
const c: Block = { kind: "text", lines: ["c"] };

describe("moveBlock", () => {
  it("moves an item toward the end (to = insertion index in the original array)", () => {
    expect(moveBlock([a, b, c], 0, 3)).toEqual([b, c, a]);
  });

  it("moves an item toward the front", () => {
    expect(moveBlock([a, b, c], 2, 0)).toEqual([c, a, b]);
  });

  it("inserting before a later sibling lands just before it", () => {
    expect(moveBlock([a, b, c], 0, 2)).toEqual([b, a, c]);
  });

  it("is a no-op when the position does not change", () => {
    expect(moveBlock([a, b, c], 1, 1)).toEqual([a, b, c]);
    expect(moveBlock([a, b, c], 1, 2)).toEqual([a, b, c]);
  });
});

describe("removeBlock", () => {
  it("removes the block at the given index", () => {
    expect(removeBlock([a, b, c], 1)).toEqual([a, c]);
  });
});

describe("toggleTodo", () => {
  it("flips a todo's checked state immutably", () => {
    const todo: Block = { kind: "todo", checked: false, text: "x" };
    const input = [todo];
    expect(toggleTodo(input, 0)).toEqual([{ kind: "todo", checked: true, text: "x" }]);
    expect(input[0]).toEqual({ kind: "todo", checked: false, text: "x" });
  });

  it("leaves non-todo blocks unchanged", () => {
    expect(toggleTodo([a], 0)).toEqual([a]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- blocks/ops`
Expected: FAIL — `./ops` cannot be resolved.

- [ ] **Step 3: Implement `ops.ts`**

Create `src/note/blocks/ops.ts`:

```ts
import type { Block } from "./parse";

/** Move the block at `from` so it lands at insertion index `to`, where `to` is
 * an index into the ORIGINAL array (0..length). This matches the drop logic in
 * the view, which counts how many cards sit above the pointer. */
export function moveBlock(blocks: Block[], from: number, to: number): Block[] {
  if (from < 0 || from >= blocks.length) return blocks;
  const next = blocks.slice();
  const [moved] = next.splice(from, 1);
  const insert = to > from ? to - 1 : to;
  next.splice(Math.max(0, Math.min(insert, next.length)), 0, moved);
  return next;
}

export function removeBlock(blocks: Block[], index: number): Block[] {
  return blocks.filter((_, i) => i !== index);
}

export function toggleTodo(blocks: Block[], index: number): Block[] {
  const block = blocks[index];
  if (!block || block.kind !== "todo") return blocks;
  return blocks.map((b, i) => (i === index ? { ...block, checked: !block.checked } : b));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- blocks/ops`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/note/blocks/ops.ts src/note/blocks/ops.test.ts
git commit -m "feat(inbox): pure move/remove/toggle block ops"
```

---

## Task 3: Inbox card view (`blocks/view.ts` + card styles)

**Files:**
- Create: `src/note/blocks/view.ts`
- Modify: `src/styles.css`

No unit test (DOM + Pointer Events). Verified manually in Task 5.

- [ ] **Step 1: Implement `view.ts`**

Create `src/note/blocks/view.ts`:

```ts
import { moveBlock, removeBlock, toggleTodo } from "./ops";
import { parseBlocks, serializeBlocks, type Block } from "./parse";

export interface InboxHost {
  /** Persist new inbox markdown. Wired to CodeMirror's setDoc so autosave +
   * the assistant's note text stay in sync; the view never touches disk itself. */
  setDoc: (md: string) => void;
}

export interface InboxView {
  /** (Re)render from the given markdown. Call on open and after external writes. */
  render: (md: string) => void;
}

export function createInboxView(parent: HTMLElement, host: InboxHost): InboxView {
  let blocks: Block[] = [];

  function commit(next: Block[]) {
    blocks = next;
    host.setDoc(serializeBlocks(blocks));
    draw();
  }

  function render(md: string) {
    blocks = parseBlocks(md);
    draw();
  }

  function draw() {
    parent.replaceChildren();
    const list = document.createElement("div");
    list.className = "inbox-list";
    blocks.forEach((block, index) => list.appendChild(renderCard(block, index)));
    if (blocks.length === 0) {
      const empty = document.createElement("div");
      empty.className = "inbox-empty";
      empty.textContent = "Inbox 还是空的 —— 划线捕获或在源码模式里写点什么。";
      list.appendChild(empty);
    }
    parent.appendChild(list);
    wireDrag(list);
  }

  function renderCard(block: Block, index: number): HTMLElement {
    const row = document.createElement("div");
    row.className = `inbox-row inbox-${block.kind}`;
    row.dataset.index = String(index);

    const handle = document.createElement("button");
    handle.className = "inbox-handle";
    handle.title = "拖动重排";
    handle.innerHTML = `<i class="ph ph-dots-six-vertical"></i>`;
    row.appendChild(handle);

    row.appendChild(renderBody(block, index));

    const del = document.createElement("button");
    del.className = "inbox-del";
    del.title = "删除";
    del.innerHTML = `<i class="ph ph-x"></i>`;
    del.onclick = () => commit(removeBlock(blocks, index));
    row.appendChild(del);

    return row;
  }

  function renderBody(block: Block, index: number): HTMLElement {
    const body = document.createElement("div");
    body.className = "inbox-body";

    if (block.kind === "todo") {
      const label = document.createElement("label");
      label.className = "inbox-todo";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = block.checked;
      box.onchange = () => commit(toggleTodo(blocks, index));
      const text = document.createElement("span");
      text.className = "inbox-todo-text";
      text.textContent = block.text || "（空待办）";
      label.append(box, text);
      body.appendChild(label);
      return body;
    }

    if (block.kind === "callout") {
      const card = document.createElement("div");
      card.className = "inbox-card inbox-callout-card";
      const title = document.createElement("div");
      title.className = "inbox-callout-title";
      title.textContent = block.title || block.calloutType;
      const text = document.createElement("div");
      text.className = "inbox-callout-body";
      text.textContent = block.body.join("\n");
      card.append(title, text);
      body.appendChild(card);
      return body;
    }

    const card = document.createElement("div");
    card.className = block.kind === "quote" ? "inbox-card inbox-quote-card" : "inbox-card inbox-text-card";
    card.textContent = (block.kind === "quote" ? block.lines : block.lines).join("\n");
    body.appendChild(card);
    return body;
  }

  // Pointer-based reorder: drag the handle, translate the row, compute the drop
  // index by how many row midpoints sit above the pointer, commit on release.
  function wireDrag(list: HTMLElement) {
    const rows = Array.from(list.querySelectorAll<HTMLElement>(".inbox-row"));
    list.querySelectorAll<HTMLElement>(".inbox-handle").forEach((handle, from) => {
      handle.onpointerdown = (event) => {
        event.preventDefault();
        const dragged = rows[from];
        const startY = event.clientY;
        const indicator = document.createElement("div");
        indicator.className = "inbox-drop-indicator";
        handle.setPointerCapture(event.pointerId);
        dragged.classList.add("inbox-dragging");
        let to = from;

        const onMove = (move: PointerEvent) => {
          dragged.style.transform = `translateY(${move.clientY - startY}px)`;
          to = rows.filter((row) => {
            const rect = row.getBoundingClientRect();
            return rect.top + rect.height / 2 < move.clientY;
          }).length;
          const ref = rows[to] ?? null;
          if (ref === dragged) {
            indicator.remove();
          } else {
            list.insertBefore(indicator, ref);
          }
        };

        const onUp = () => {
          handle.releasePointerCapture(event.pointerId);
          handle.onpointermove = null;
          handle.onpointerup = null;
          indicator.remove();
          dragged.classList.remove("inbox-dragging");
          dragged.style.transform = "";
          if (to !== from && !(to === from + 1)) {
            commit(moveBlock(blocks, from, to));
          }
        };

        handle.onpointermove = onMove;
        handle.onpointerup = onUp;
      };
    });
  }

  return { render };
}
```

- [ ] **Step 2: Add card styles to `styles.css`**

Append to the end of `src/styles.css` (before any closing `@media` is not required — these are top-level rules; add them after the `.switch-new-input` block from Plan 2):

```css
#inbox-root {
  height: 100%;
  overflow: auto;
  padding: 12px 14px;
  background: #f8f8f7;
}

.inbox-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.inbox-empty {
  padding: 24px 8px;
  color: #9ca3af;
  font-size: 13px;
  text-align: center;
}

.inbox-row {
  position: relative;
  display: grid;
  grid-template-columns: 20px 1fr 24px;
  align-items: start;
  gap: 6px;
}

.inbox-row.inbox-dragging {
  opacity: 0.85;
  z-index: 5;
}

.inbox-handle,
.inbox-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms ease;
}

.inbox-handle {
  cursor: grab;
}

.inbox-row:hover .inbox-handle,
.inbox-row:hover .inbox-del {
  opacity: 1;
}

.inbox-handle:hover,
.inbox-del:hover {
  background: rgba(0, 0, 0, 0.06);
  color: #374151;
}

.inbox-body {
  min-width: 0;
}

.inbox-card {
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 8px;
  background: #fff;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.inbox-callout-card {
  border-left: 3px solid #6b7280;
  background: rgba(107, 114, 128, 0.06);
}

.inbox-callout-title {
  margin-bottom: 2px;
  color: #6b7280;
  font-size: 12px;
  font-weight: 600;
}

.inbox-callout-body {
  white-space: pre-wrap;
  word-break: break-word;
}

.inbox-quote-card {
  color: #6b7280;
  font-style: italic;
}

.inbox-todo {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 2px;
  font-size: 14px;
  cursor: pointer;
}

.inbox-todo input {
  flex: none;
}

.inbox-todo input:checked + .inbox-todo-text {
  color: #9ca3af;
  text-decoration: line-through;
}

.inbox-drop-indicator {
  height: 2px;
  margin: 0 24px 0 26px;
  border-radius: 1px;
  background: #2563eb;
}

@media (prefers-color-scheme: dark) {
  #inbox-root {
    background: #1e1e1e;
  }

  .inbox-card {
    border-color: rgba(255, 255, 255, 0.1);
    background: #262626;
  }

  .inbox-callout-card {
    border-left-color: #9ca3af;
    background: rgba(255, 255, 255, 0.04);
  }

  .inbox-handle:hover,
  .inbox-del:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #d1d5db;
  }
}
```

- [ ] **Step 3: Type-check (view is not wired yet, so this only checks the new file compiles)**

Run: `npx tsc --noEmit`
Expected: PASS — `view.ts` compiles; it is not imported anywhere yet so no call-site errors.

- [ ] **Step 4: Commit**

```bash
git add src/note/blocks/view.ts src/styles.css
git commit -m "feat(inbox): block card view with drag-reorder, delete, todo toggle"
```

---

## Task 4: Wire the inbox view + source toggle (`main.ts`, `topbar.ts`, layout CSS)

**Files:**
- Modify: `src/note/main.ts`
- Modify: `src/note/topbar.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: Add the source/block toggle to the topbar**

In `src/note/topbar.ts`, extend `TopbarCallbacks` (after `onNewProject`):

```ts
  /** 顶栏右侧切换：Inbox 卡片视图 ⇄ 原始 Markdown 源码。 */
  onToggleSource: () => void;
```

In `renderTopbar`, add the toggle button just before the `new-btn` inside the `.topbar` template (between the `</div>` that closes `.topbar-left` and the `new-btn`):

```html
      <button class="src-toggle" id="src-toggle" title="切换源码 / 卡片"><i class="ph ph-cards"></i></button>
```

Then wire it (after the `new-btn` wiring):

```ts
  root.querySelector<HTMLElement>("#src-toggle")!.onclick = callbacks.onToggleSource;
```

Add an exported setter at the end of the file:

```ts
export function setSourceToggle(mode: "block" | "source") {
  const button = document.querySelector<HTMLElement>("#src-toggle")!;
  button.innerHTML =
    mode === "block" ? `<i class="ph ph-code"></i>` : `<i class="ph ph-cards"></i>`;
  button.title = mode === "block" ? "查看源码" : "查看卡片";
}
```

- [ ] **Step 2: Restructure the note-body markup + imports in `main.ts`**

In `src/note/main.ts`, change the `#note-body` markup so the editor lives in a `#text-col` wrapper alongside `#inbox-root`. Replace the existing `app.innerHTML` block:

```ts
app.innerHTML = `
  <div id="titlebar-root"></div>
  <div id="topbar-root"></div>
  <div id="note-body">
    <div id="left-col"></div>
    <div id="text-col">
      <div id="editor-root"></div>
      <div id="inbox-root"></div>
    </div>
    <div id="assistant-region"></div>
  </div>
  <div id="version-root"></div>
`;
```

Update the topbar import to add the new setter:

```ts
import { renderTitlebar, renderTopbar, setDirLabel, setProjectLabel, setSourceToggle } from "./topbar";
```

Add the inbox-view import near the other `./` imports (e.g. after the `layout-controller` import):

```ts
import { createInboxView } from "./blocks/view";
```

- [ ] **Step 3: Mount the inbox view and add mode state**

In `src/note/main.ts`, just after `const assistantRegion = ...` and the existing `let current ...` state, add the inbox root + view + mode. Place this right after the `editor` is created (after the `requestAnimationFrame(() => initScrollbar(editorRoot));` line):

```ts
const inboxRoot = document.querySelector<HTMLElement>("#inbox-root")!;
const inboxView = createInboxView(inboxRoot, {
  // 卡片任何改动 → 重写整份 _inbox.md 到 CodeMirror（触发既有 autosave / 助手同步）。
  setDoc: (md) => setDoc(editor, md),
});

let inboxMode: "block" | "source" = "block";

function applyInboxMode() {
  app.classList.toggle("inbox-source", inboxMode === "source");
  setSourceToggle(inboxMode);
  if (inboxMode === "source") {
    editor.requestMeasure();
  } else {
    inboxView.render(editor.state.doc.toString());
  }
}

function toggleSource() {
  inboxMode = inboxMode === "block" ? "source" : "block";
  applyInboxMode();
}
```

- [ ] **Step 4: Render the inbox on open and after external writes**

In `openProject` (added in Plan 2), after `setDoc(editor, await readNote(entry.path));` add a render so the cards reflect the freshly-loaded file:

```ts
  inboxView.render(editor.state.doc.toString());
```

In the `onNoteUpdated` handler, after `applyRemoteDoc(...)`, keep the cards fresh when an agent rewrite lands while in block mode. Replace the handler body:

```ts
void onNoteUpdated(async (payload) => {
  if (!current || payload.path !== current.entry.path) return;
  applyRemoteDoc(await readNote(current.entry.path));
  if (inboxMode === "block") inboxView.render(editor.state.doc.toString());
});
```

In the `quote-captured` listener, after the capture is appended, re-render cards in block mode instead of focusing the hidden editor. Replace the listener body:

```ts
void listen<string>("quote-captured", (event) => {
  const insert = buildAppendInsert(editor.state.doc.toString(), event.payload);
  appendToEnd(editor, insert);
  const pos = editor.state.doc.length;
  editor.dispatch({
    changes: { from: pos, insert: "\n" },
    selection: { anchor: pos + 1 },
    scrollIntoView: true,
  });
  if (inboxMode === "block") {
    inboxView.render(editor.state.doc.toString());
  } else {
    editor.focus();
  }
});
```

- [ ] **Step 5: Wire the toggle callback and initialize the mode**

In the `renderTopbar({ ... })` call, add the new callback:

```ts
  onToggleSource: toggleSource,
```

At the end of `init()`, after `layoutController.apply();`, initialize the mode (defaults to block, which also does the first card render via `applyInboxMode`):

```ts
  applyInboxMode();
```

- [ ] **Step 6: Add the layout CSS for the text-col wrapper + block-mode visibility**

In `src/styles.css`, add after the existing `#left-col { ... }` rule:

```css
#text-col {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
}
```

And add, right after the `#editor-root { ... }` rule block, the mode visibility rules (block mode is the default: inbox shown, editor hidden):

```css
#editor-root {
  display: none;
}

#app.inbox-source #editor-root {
  display: block;
}

#app.inbox-source #inbox-root {
  display: none;
}
```

(Note: keep the existing `#editor-root` properties — `position/min-width/min-height/height/overflow/background` — and just add the `display: none;` line to that existing rule rather than duplicating it. The two `#app.inbox-source ...` rules are new.)

Add the toggle button style after `.new-btn:hover` (light) — it reuses the round-icon-button look:

```css
.src-toggle {
  width: 32px;
  height: 32px;
  justify-content: center;
  border-radius: 50% !important;
}

.src-toggle:hover {
  background: rgba(0, 0, 0, 0.06) !important;
}
```

And in the dark `@media` block, after `.new-btn:hover`:

```css
  .src-toggle:hover {
    background: rgba(255, 255, 255, 0.08) !important;
  }
```

- [ ] **Step 7: Type-check + run all unit tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — tsc clean; all suites green including the new `blocks/parse` (9) and `blocks/ops` (7).

- [ ] **Step 8: Commit**

```bash
git add src/note/main.ts src/note/topbar.ts src/styles.css
git commit -m "feat(inbox): mount block view in note window with source toggle"
```

---

## Task 5: Build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Build the bundle**

Run: `npm run build`
Expected: PASS — `tsc` clean and Vite bundles both entry pages.

- [ ] **Step 2: Run the app and verify**

Run: `npm run tauri dev`

Verify, in order:
1. Opening a project shows `_inbox.md` as cards (empty project shows the empty-state hint).
2. With a project that has content (type some in source mode first, or capture a clip), blockquotes render as quote cards, `> [!quote] …` as callout cards, `- [ ] …` as todo rows.
3. Hovering a row reveals the drag handle (left) and delete (right). Dragging the handle reorders the row; the new order is written to `_inbox.md` on disk.
4. Toggling a todo checkbox flips it on disk (`- [ ]` ⇄ `- [x]`) and strikes the text through.
5. Deleting a row removes that block from `_inbox.md`.
6. The topbar toggle (`ph-cards`/`ph-code`) swaps to the raw CodeMirror source on the same file; editing there and toggling back re-renders the cards.
7. A capture (⌥⌘C) while in block mode appends a new card; the assistant still reads the current inbox text.

- [ ] **Step 3: Final commit (only if verification needed tweaks)**

```bash
git add -A
git commit -m "chore(inbox): plan 3 verification tweaks"
```

(Skip if nothing changed.)

---

## Self-Review

- **Spec coverage (design §"Inbox —— 轻量块编辑器" + roadmap Plan 3):** "块 = Markdown 顶层块" → `parseBlocks` (Task 1). "hover 出把手，可拖动重排、删除" → handle drag + delete in `view.ts` (Task 3). 剪藏→callout, 待办→`- [ ]`/`- [x]` (勾选写回, 划掉), 其余→段落 → block kinds + rendering (Tasks 1, 3). "双向无损" → round-trip test (Task 1). "**不做** 斜杠菜单/嵌套/分栏" → explicit non-goals; structural-only per approved design. "Pure parse/serialize helpers Vitest-tested" → Tasks 1–2. "New `src/note/blocks/` module + editor wiring" → Tasks 1–4.
- **Placeholder scan:** every code step shows full code; the only conditional commit (Task 5 Step 3) is explicitly marked skip-if-unchanged.
- **Type consistency:** `Block` union defined in `parse.ts` (Task 1) is imported by `ops.ts` (Task 2) and `view.ts` (Task 3); `moveBlock(blocks, from, to)` with `to` = original-array insertion index is consistent between the ops test (Task 2) and the view's drop calculation (Task 3, `to = rows.filter(midpoint < pointerY).length`); `InboxHost.setDoc` / `InboxView.render` signatures match the `createInboxView` wiring in `main.ts` (Task 4); `setSourceToggle("block" | "source")` matches `inboxMode` (Task 4).
- **Architecture invariant:** CodeMirror remains the source of truth — every block mutation goes `commit → host.setDoc → setDoc(editor) → onChange → scheduleSave`, so autosave/assistant/versions are untouched (no new persistence path).
