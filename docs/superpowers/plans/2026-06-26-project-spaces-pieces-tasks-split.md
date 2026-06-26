# Project Spaces — Plans 4–7 Consolidated Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the project-spaces workflow by adding the 成品 multi-file editor (switch / new / rename), the 清单 (`_tasks.md`) panel, a width-gated split layout (Inbox ｜ 成品 with the assistant forced floating), and rewiring capture to drop a `> [!quote]` clip into the current project's `_inbox.md`.

**Architecture:** Two independent CodeMirror surfaces coexist in `#note-body`: the existing **Inbox** editor (block view over `_inbox.md`, source-toggle) in `#text-col`, and a new **成品** editor+preview over the currently-selected piece in `#piece-col`. A topbar **segmented control** picks the visible surface in single-pane; a width-gated **split toggle** shows both side-by-side and pushes the assistant to floating. The assistant + capture always know the project's fixed `_inbox.md` path independently of which surface is focused; the assistant's `active_note` follows the focused surface. 清单 is a separate overlay panel bound to `_tasks.md`. All non-trivial logic (split layout math, tasks parse/serialize, piece-name sanitizing, clip formatting) lives in pure, unit-tested helpers; DOM wiring is verified manually.

**Tech Stack:** TypeScript + Vite, CodeMirror (two instances), native Pointer Events, Vitest (node env), Rust/Tauri 2 commands (`serde`).

---

## Spec → Plan mapping

- Plan 4 (成品 switcher + rename) → Tasks 2, 6.
- Plan 5 (清单 panel) → Tasks 3, 7.
- Plan 6 (split layout + right-slot assistant) → Tasks 1, 5.
- Plan 7 (capture → current `_inbox.md` as clip) → Tasks 4, 8.

## Key decisions (resolving spec ambiguity)

- **Two persistent editors**, not one repointed editor — split mode needs both visible at once, and persistent instances keep undo history / scroll per surface.
- **Assistant target follows the focused surface.** When the user focuses the 成品 editor, `set_active_note` points at the piece (assistant edits 成品 — the "润色" surface); when focused on Inbox it points at `_inbox.md`. Capture is unaffected — it always targets the project's `_inbox.md` via the fixed inbox path.
- **Split is width-gated.** The split toggle only takes effect when the window is wide enough to hold two comfortable panes; below that it falls back to single-pane segmented switching automatically (mirrors the existing inline↔floating gating).
- **成品 switcher** reuses the already-present `.note-name` / `.note-name-input` CSS (a centered topbar pill + in-place rename input) and the existing `create_note` / `rename_note` backend commands.

## File Structure

**Create:**
- `src/note/split.ts` — pure split-layout math: `canSplit`, `computeSplitLayout`. Vitest-tested.
- `src/note/split.test.ts`
- `src/note/tasks.ts` — pure `_tasks.md` model: `parseTasks`, `serializeTasks`, `toggleTask`, `addTask`. Vitest-tested.
- `src/note/tasks.test.ts`
- `src/note/piece-name.ts` — pure `sanitizePieceStem` (guards `_` prefix / illegal chars). Vitest-tested.
- `src/note/piece-name.test.ts`
- `src/note/piece-switcher.ts` — DOM: centered piece pill + dropdown (switch / new / rename-in-place).
- `src/note/tasks-panel.ts` — DOM: toggleable 清单 panel bound to `_tasks.md`.

**Modify:**
- `src-tauri/src/quote.rs` — add `format_clip` (callout) + tests.
- `src-tauri/src/capture.rs` — emit the clip callout instead of a plain blockquote.
- `src/note/layout-controller.ts` — accept a `split` flag; route to split geometry; force assistant floating when split is active.
- `src/note/main.ts` — second (成品) editor, surface state (single/split + active surface), piece switcher + tasks panel wiring, capture → inbox path, focus → `set_active_note`.
- `src/note/topbar.ts` — segmented [Inbox｜成品] control, split toggle, 清单 toggle, piece pill mount point.
- `src/styles.css` — `#piece-col`, split grid, segmented control, tasks panel, piece pill (reuse existing `.note-name`).

---

## Task 1: Split layout math (`split.ts`)

**Files:**
- Create: `src/note/split.ts`
- Test: `src/note/split.test.ts`

The existing `layout.ts` single-curve stays untouched. Split is a separate, simpler geometry the controller selects when split is requested *and* the window is wide enough. Panes are equal-width, clamped to a max (overflow spills into the side margins so very wide windows stay readable); below the minimum the split can't happen.

- [ ] **Step 1: Write the failing test**

Create `src/note/split.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canSplit, computeSplitLayout, SPLIT_PREFS } from "./split";

describe("canSplit", () => {
  it("is false below the two-pane minimum width", () => {
    const min = 2 * SPLIT_PREFS.pad + 2 * SPLIT_PREFS.paneMin + SPLIT_PREFS.gap;
    expect(canSplit(min - 1)).toBe(false);
    expect(canSplit(min)).toBe(true);
  });
});

describe("computeSplitLayout", () => {
  it("splits the inner width into two equal panes with pad margins and a gap", () => {
    const layout = computeSplitLayout(2 * SPLIT_PREFS.pad + 2 * SPLIT_PREFS.paneMin + SPLIT_PREFS.gap);
    expect(layout.leftMargin).toBe(SPLIT_PREFS.pad);
    expect(layout.rightMargin).toBe(SPLIT_PREFS.pad);
    expect(layout.inboxWidth).toBe(SPLIT_PREFS.paneMin);
    expect(layout.pieceWidth).toBe(SPLIT_PREFS.paneMin);
    expect(layout.gap).toBe(SPLIT_PREFS.gap);
  });

  it("clamps panes at paneMax and spills the extra into the margins", () => {
    const wide = 2 * SPLIT_PREFS.pad + 2 * SPLIT_PREFS.paneMax + SPLIT_PREFS.gap + 400;
    const layout = computeSplitLayout(wide);
    expect(layout.inboxWidth).toBe(SPLIT_PREFS.paneMax);
    expect(layout.pieceWidth).toBe(SPLIT_PREFS.paneMax);
    // 200 of spill on each side, on top of the base pad.
    expect(layout.leftMargin).toBe(SPLIT_PREFS.pad + 200);
    expect(layout.rightMargin).toBe(SPLIT_PREFS.pad + 200);
  });

  it("grows panes evenly between min and max", () => {
    const width = 2 * SPLIT_PREFS.pad + 2 * SPLIT_PREFS.paneMin + SPLIT_PREFS.gap + 200;
    const layout = computeSplitLayout(width);
    expect(layout.inboxWidth).toBe(SPLIT_PREFS.paneMin + 100);
    expect(layout.pieceWidth).toBe(SPLIT_PREFS.paneMin + 100);
    expect(layout.leftMargin).toBe(SPLIT_PREFS.pad);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- split`
Expected: FAIL — `./split` cannot be resolved.

- [ ] **Step 3: Implement `split.ts`**

Create `src/note/split.ts`:

```ts
/**
 * 分屏几何（纯逻辑）：宽窗 + 开分屏时把内容区切成 [pad][Inbox][gap][成品][pad]。
 * 两栏等宽，夹在 [paneMin, paneMax]；超出 paneMax 的富余溢进左右边距（窗口超宽时居中）。
 * 窄到放不下两栏（< canSplit）时由调用方回退单栏。助手此时一律 floating，不参与本几何。
 */
export interface SplitPrefs {
  pad: number;
  gap: number;
  paneMin: number;
  paneMax: number;
}

export interface SplitLayout {
  leftMargin: number;
  inboxWidth: number;
  gap: number;
  pieceWidth: number;
  rightMargin: number;
}

export const SPLIT_PREFS: SplitPrefs = {
  pad: 28,
  gap: 24,
  paneMin: 360,
  paneMax: 560,
};

export function canSplit(width: number, prefs: SplitPrefs = SPLIT_PREFS): boolean {
  return width >= 2 * prefs.pad + 2 * prefs.paneMin + prefs.gap;
}

export function computeSplitLayout(width: number, prefs: SplitPrefs = SPLIT_PREFS): SplitLayout {
  const inner = width - 2 * prefs.pad - prefs.gap;
  const pane = Math.max(prefs.paneMin, Math.min(prefs.paneMax, inner / 2));
  const margin = (width - 2 * pane - prefs.gap) / 2;
  return {
    leftMargin: margin,
    inboxWidth: pane,
    gap: prefs.gap,
    pieceWidth: pane,
    rightMargin: margin,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- split`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/note/split.ts src/note/split.test.ts
git commit -m "feat(layout): pure split-layout math (Inbox | 成品)"
```

---

## Task 2: Piece-name sanitizing (`piece-name.ts`)

**Files:**
- Create: `src/note/piece-name.ts`
- Test: `src/note/piece-name.test.ts`

成品 = a project `.md` whose name does **not** start with `_`. Renaming must reject the `_` prefix (it would turn the piece into a system file) and strip path/illegal characters, mirroring the Rust `sanitize_folder_name` rules.

- [ ] **Step 1: Write the failing test**

Create `src/note/piece-name.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sanitizePieceStem } from "./piece-name";

describe("sanitizePieceStem", () => {
  it("keeps a normal name", () => {
    expect(sanitizePieceStem("读书笔记")).toBe("读书笔记");
  });

  it("replaces path separators and illegal characters with -", () => {
    expect(sanitizePieceStem("a/b\\c:d*e?")).toBe("a-b-c-d-e-");
  });

  it("strips a leading underscore so a piece can't become a system file", () => {
    expect(sanitizePieceStem("_inbox")).toBe("inbox");
    expect(sanitizePieceStem("__x")).toBe("x");
  });

  it("drops a trailing .md extension", () => {
    expect(sanitizePieceStem("note.md")).toBe("note");
  });

  it("trims surrounding whitespace and dots", () => {
    expect(sanitizePieceStem("  draft.  ")).toBe("draft");
  });

  it("returns empty string for an all-illegal / empty input", () => {
    expect(sanitizePieceStem("   ")).toBe("");
    expect(sanitizePieceStem("___")).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- piece-name`
Expected: FAIL — `./piece-name` cannot be resolved.

- [ ] **Step 3: Implement `piece-name.ts`**

Create `src/note/piece-name.ts`:

```ts
/**
 * 把用户输入的成品名归一为安全文件名（不含扩展名）。
 * - 去掉结尾 `.md`
 * - 路径分隔符与 Windows 非法字符 → `-`
 * - 去掉前导 `_`（否则会变成系统文件 `_inbox`/`_tasks`）
 * - 修剪首尾空白与点；空结果交由调用方拦截（不落盘）。
 */
export function sanitizePieceStem(name: string): string {
  let s = name.trim().replace(/\.md$/i, "");
  s = s.replace(/[/\\:*?"<>|]/g, "-");
  s = s.trim().replace(/^[.]+|[.]+$/g, "").trim();
  s = s.replace(/^_+/, "");
  return s;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- piece-name`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/note/piece-name.ts src/note/piece-name.test.ts
git commit -m "feat(piece): sanitize 成品 rename stems"
```

---

## Task 3: 清单 task model (`tasks.ts`)

**Files:**
- Create: `src/note/tasks.ts`
- Test: `src/note/tasks.test.ts`

`_tasks.md` is a flat `- [ ]` / `- [x]` checklist. Non-todo lines (e.g. a heading) are preserved verbatim so the file stays valid Markdown / Obsidian-friendly, but only todo lines render as checkable rows.

- [ ] **Step 1: Write the failing test**

Create `src/note/tasks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseTasks, serializeTasks, toggleTask, addTask, type TaskLine } from "./tasks";

describe("parseTasks", () => {
  it("parses checked + unchecked todos, one per line", () => {
    expect(parseTasks("- [ ] 写提纲\n- [x] 收集资料")).toEqual([
      { kind: "todo", checked: false, text: "写提纲" },
      { kind: "todo", checked: true, text: "收集资料" },
    ]);
  });

  it("keeps non-todo lines as raw, normalizing CRLF and dropping blank lines", () => {
    expect(parseTasks("# 标题\r\n\r\n- [ ] a")).toEqual([
      { kind: "raw", text: "# 标题" },
      { kind: "todo", checked: false, text: "a" },
    ]);
  });
});

describe("serializeTasks", () => {
  it("round-trips a mixed checklist", () => {
    const md = "# 标题\n- [ ] a\n- [x] b";
    expect(serializeTasks(parseTasks(md))).toBe(md);
  });

  it("serializes an empty list to an empty string", () => {
    expect(serializeTasks([])).toBe("");
  });
});

describe("toggleTask", () => {
  it("flips only the targeted todo, immutably", () => {
    const items: TaskLine[] = [{ kind: "todo", checked: false, text: "a" }];
    expect(toggleTask(items, 0)).toEqual([{ kind: "todo", checked: true, text: "a" }]);
    expect(items[0]).toEqual({ kind: "todo", checked: false, text: "a" });
  });

  it("ignores raw lines", () => {
    const items: TaskLine[] = [{ kind: "raw", text: "x" }];
    expect(toggleTask(items, 0)).toEqual(items);
  });
});

describe("addTask", () => {
  it("appends a new unchecked todo", () => {
    expect(addTask([], "新任务")).toEqual([{ kind: "todo", checked: false, text: "新任务" }]);
  });

  it("ignores blank input", () => {
    expect(addTask([], "   ")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tasks`
Expected: FAIL — `./tasks` cannot be resolved.

- [ ] **Step 3: Implement `tasks.ts`**

Create `src/note/tasks.ts`:

```ts
export type TaskLine =
  | { kind: "todo"; checked: boolean; text: string }
  | { kind: "raw"; text: string };

const TODO_RE = /^- \[([ xX])\](?: (.*))?$/;

export function parseTasks(md: string): TaskLine[] {
  return md
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const m = TODO_RE.exec(line);
      if (m) return { kind: "todo", checked: m[1] !== " ", text: m[2] ?? "" } as TaskLine;
      return { kind: "raw", text: line } as TaskLine;
    });
}

export function serializeTasks(items: TaskLine[]): string {
  return items
    .map((item) =>
      item.kind === "todo"
        ? `- [${item.checked ? "x" : " "}]${item.text ? ` ${item.text}` : ""}`
        : item.text,
    )
    .join("\n");
}

export function toggleTask(items: TaskLine[], index: number): TaskLine[] {
  const item = items[index];
  if (!item || item.kind !== "todo") return items;
  return items.map((it, i) => (i === index ? { ...item, checked: !item.checked } : it));
}

export function addTask(items: TaskLine[], text: string): TaskLine[] {
  const trimmed = text.trim();
  if (!trimmed) return items;
  return [...items, { kind: "todo", checked: false, text: trimmed }];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tasks`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/note/tasks.ts src/note/tasks.test.ts
git commit -m "feat(tasks): pure _tasks.md parse/serialize/toggle/add"
```

---

## Task 4: Clip callout formatting (`quote.rs`)

**Files:**
- Modify: `src-tauri/src/quote.rs`
- Modify: `src-tauri/src/capture.rs`

Per spec, a capture becomes a clip **callout** `> [!quote]` (renders as a callout card in the block view, native callout in Obsidian) instead of a plain blockquote.

- [ ] **Step 1: Add a failing test for `format_clip`**

In `src-tauri/src/quote.rs`, add to the `tests` module:

```rust
    #[test]
    fn clip_wraps_text_as_quote_callout() {
        assert_eq!(format_clip("hello"), "> [!quote]\n> hello");
    }

    #[test]
    fn clip_preserves_blank_lines_in_body() {
        assert_eq!(format_clip("a\n\nb"), "> [!quote]\n> a\n>\n> b");
    }
```

- [ ] **Step 2: Run to verify it fails**

Run (from `src-tauri/`): `cargo test quote::`
Expected: FAIL — `format_clip` not found.

- [ ] **Step 3: Implement `format_clip`**

In `src-tauri/src/quote.rs`, add after `format_quote`:

```rust
/// Format selected text as a `> [!quote]` clip callout: a callout header line
/// followed by the text as quoted body. FloatNote renders this as a callout card;
/// Obsidian renders it as a native callout. (No source URL is available from a
/// clipboard capture, so the header carries no title in v1.)
pub fn format_clip(text: &str) -> String {
    format!("> [!quote]\n{}", format_quote(text))
}
```

- [ ] **Step 4: Run to verify it passes**

Run (from `src-tauri/`): `cargo test quote::`
Expected: PASS.

- [ ] **Step 5: Switch capture to emit the clip callout**

In `src-tauri/src/capture.rs`, change the block formatting line:

```rust
    let block = crate::quote::format_clip(trimmed);
```

(was `crate::quote::format_quote(trimmed)`).

- [ ] **Step 6: cargo check + commit**

Run (from `src-tauri/`): `cargo check`
Expected: PASS (no warnings about unused `format_quote`; it stays referenced by its own tests).

```bash
git add src-tauri/src/quote.rs src-tauri/src/capture.rs
git commit -m "feat(capture): drop clips as > [!quote] callouts"
```

---

## Task 5: Split routing in the layout controller (`layout-controller.ts`)

**Files:**
- Modify: `src/note/layout-controller.ts`
- Modify: `src/styles.css` (split grid + `#piece-col`)

The controller gains a `split` flag. When split is requested **and** `canSplit(width)`, it writes split CSS vars, toggles `split-active` on `#app`, and forces the assistant to floating geometry (the right slot is now 成品). Otherwise it behaves exactly as today.

- [ ] **Step 1: Extend the controller**

Replace `src/note/layout-controller.ts` with:

```ts
import { computeLayout, DEFAULT_PREFS, type Layout, type Mode } from "./layout";
import { canSplit, computeSplitLayout } from "./split";

export interface LayoutController {
  /** 按当前窗口宽度重算并落地。 */
  apply: () => void;
  /** 开/关整个助手。 */
  setOpen: (open: boolean) => void;
  /** 请求/取消分屏（仅在窗口够宽时实际生效）。 */
  setSplit: (split: boolean) => void;
  /** 当前是否真正处于分屏（够宽 + 已请求）。供调用方决定成品栏归属。 */
  isSplit: () => boolean;
}

export function createLayoutController(
  app: HTMLElement,
  init: { open: boolean },
): LayoutController {
  let open = init.open;
  let splitRequested = false;
  let splitActive = false;

  function apply() {
    const width = window.innerWidth;
    splitActive = splitRequested && canSplit(width);

    if (splitActive) {
      applySplit(width);
    } else {
      applySingle(width);
    }
    app.classList.toggle("split-active", splitActive);
  }

  function applySingle(width: number) {
    const prefs = { ...DEFAULT_PREFS, open };
    const layout: Layout = computeLayout(width, prefs);
    app.style.setProperty("--left", `${layout.leftMargin}px`);
    app.style.setProperty("--text", `${layout.textWidth}px`);
    app.style.setProperty("--right", `${layout.rightMargin}px`);
    app.style.setProperty("--assist", `${layout.assistantWidth}px`);
    app.style.setProperty("--bot-x", `${layout.botX}px`);
    const botXOpen = Math.min(
      layout.botX,
      width - prefs.botInset - prefs.botW - prefs.inputReserve,
    );
    app.style.setProperty("--bot-x-open", `${botXOpen}px`);
    setMode(app, layout.mode);
  }

  function applySplit(width: number) {
    const s = computeSplitLayout(width);
    app.style.setProperty("--left", `${s.leftMargin}px`);
    app.style.setProperty("--text", `${s.inboxWidth}px`);
    app.style.setProperty("--split-gap", `${s.gap}px`);
    app.style.setProperty("--piece", `${s.pieceWidth}px`);
    app.style.setProperty("--right", `${s.rightMargin}px`);
    // 助手强制 floating：贴窗口右下，随右缘走。closed 时不显示。
    const prefs = { ...DEFAULT_PREFS, open };
    const botX = width - prefs.botInset - prefs.botW;
    app.style.setProperty("--bot-x", `${botX}px`);
    app.style.setProperty(
      "--bot-x-open",
      `${Math.min(botX, width - prefs.botInset - prefs.botW - prefs.inputReserve)}px`,
    );
    setMode(app, open ? "floating" : "closed");
  }

  return {
    apply,
    setOpen(value) {
      open = value;
      apply();
    },
    setSplit(value) {
      splitRequested = value;
      apply();
    },
    isSplit() {
      return splitActive;
    },
  };
}

function setMode(app: HTMLElement, mode: Mode) {
  app.classList.toggle("mode-inline", mode === "inline");
  app.classList.toggle("mode-floating", mode === "floating");
  app.classList.toggle("mode-closed", mode === "closed");
}
```

- [ ] **Step 2: Add split grid CSS**

In `src/styles.css`, replace the `#note-body` `grid-template-columns` rule so it has a piece column, and add split overrides. Find:

```css
  grid-template-columns: var(--left) var(--text) var(--right);
```

Change to:

```css
  grid-template-columns: var(--left) var(--text) var(--right);
  --split-gap: 0px;
  --piece: 0px;
```

Then after the `#text-col { ... }` rule, add:

```css
#piece-col {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: none;
}

/* 分屏：[左边距][Inbox][gap][成品][右边距]。助手此时为 floating，覆盖在右下。 */
#app.split-active #note-body {
  grid-template-columns: var(--left) var(--text) var(--split-gap) var(--piece) var(--right);
}

#app.split-active #piece-col {
  display: block;
}

/* 非分屏：成品栏所占的列在网格里只剩两列模板时不存在；piece 内容随单栏 segmented 切换显隐（见下）。 */
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (controller compiles; new methods unused until Task 5-wiring in Task 6/main).

- [ ] **Step 4: Commit**

```bash
git add src/note/layout-controller.ts src/styles.css
git commit -m "feat(layout): split routing + grid, assistant forced floating"
```

---

## Task 6: 成品 editor + piece switcher + surface state (`main.ts`, `topbar.ts`, `piece-switcher.ts`)

**Files:**
- Create: `src/note/piece-switcher.ts`
- Modify: `src/note/main.ts`
- Modify: `src/note/topbar.ts`
- Modify: `src/styles.css`

This is the integration task: a second CodeMirror for 成品, a piece switcher (switch / new / rename), the surface state (which surface is visible single-pane, plus the split toggle), and routing focus → `set_active_note`.

- [ ] **Step 1: Create the piece switcher**

Create `src/note/piece-switcher.ts`:

```ts
import { sanitizePieceStem } from "./piece-name";
import { createNote, listPieces, renameNote, type NoteEntry } from "./notes-state";

export interface PieceSwitcherHost {
  /** 当前项目文件夹路径。 */
  dir: () => string;
  /** 当前成品（用于高亮 / 重命名旧名）。 */
  current: () => NoteEntry | null;
  /** 切到某成品（switch / 新建后）。 */
  open: (entry: NoteEntry) => void;
}

/** 居中成品名「药丸」+ 下拉（切换 / 新建 / 就地重命名）。返回一个 refresh 钩子刷新标签。 */
export function createPieceSwitcher(mount: HTMLElement, host: PieceSwitcherHost) {
  let menuEl: HTMLElement | null = null;

  function setLabel(name: string) {
    pill.querySelector<HTMLElement>(".piece-label")!.textContent = name;
  }

  function closeMenu() {
    menuEl?.remove();
    menuEl = null;
  }

  const pill = document.createElement("button");
  pill.className = "note-name piece-pill";
  pill.title = "切换 / 重命名成品";
  pill.innerHTML = `<span class="piece-label">-</span>`;
  pill.onclick = () => void openMenu();
  mount.appendChild(pill);

  async function openMenu() {
    if (menuEl) {
      closeMenu();
      return;
    }
    const dir = host.dir();
    if (!dir) return;
    const pieces = await listPieces(dir);
    menuEl = document.createElement("div");
    menuEl.className = "switch-menu";
    const rect = pill.getBoundingClientRect();
    menuEl.style.left = `${rect.left}px`;
    menuEl.style.top = `${rect.bottom + 2}px`;

    const cur = host.current();
    for (const piece of pieces) {
      const item = document.createElement("button");
      item.className = "switch-item";
      item.textContent = piece.name;
      if (cur && piece.path === cur.path) item.classList.add("active");
      item.onclick = () => {
        closeMenu();
        host.open(piece);
      };
      menuEl.appendChild(item);
    }

    const renameItem = document.createElement("button");
    renameItem.className = "switch-item";
    renameItem.innerHTML = `<i class="ph ph-pencil-simple"></i> 重命名当前`;
    renameItem.onclick = (e) => {
      e.stopPropagation();
      void startRename();
    };
    menuEl.appendChild(renameItem);

    const newItem = document.createElement("button");
    newItem.className = "switch-item switch-new";
    newItem.innerHTML = `<i class="ph ph-plus"></i> 新建成品`;
    newItem.onclick = async (e) => {
      e.stopPropagation();
      const entry = await createNote(host.dir());
      closeMenu();
      host.open(entry);
    };
    menuEl.appendChild(newItem);

    document.body.appendChild(menuEl);
    setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  }

  async function startRename() {
    const cur = host.current();
    if (!cur) return;
    const input = document.createElement("input");
    input.className = "note-name-input";
    input.value = cur.name;
    pill.replaceWith(input);
    input.focus();
    input.select();
    input.addEventListener("click", (e) => e.stopPropagation());

    let submitting = false;
    const restore = () => {
      input.replaceWith(pill);
    };
    async function confirm() {
      if (submitting) return;
      const stem = sanitizePieceStem(input.value);
      if (!stem || stem === cur!.name) {
        restore();
        closeMenu();
        return;
      }
      submitting = true;
      try {
        const newPath = await renameNote(host.dir(), cur!.name, stem);
        closeMenu();
        host.open({ name: stem, path: newPath });
      } catch {
        input.classList.add("rename-error");
        submitting = false;
      }
    }
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); void confirm(); }
      if (e.key === "Escape") { e.preventDefault(); restore(); closeMenu(); }
    });
  }

  return { setLabel, closeMenu };
}
```

- [ ] **Step 2: Extend the topbar**

In `src/note/topbar.ts`, extend `TopbarCallbacks` (after `onToggleSource`):

```ts
  /** 单栏分段切换：显示 Inbox 还是 成品。 */
  onSelectSurface: (surface: "inbox" | "piece") => void;
  /** 分屏开关（仅宽窗生效）。 */
  onToggleSplit: () => void;
  /** 清单面板开关。 */
  onToggleTasks: () => void;
```

In `renderTopbar`, replace the `.topbar` inner markup with one that adds the segmented control (center-left), a piece-pill mount, and the split / tasks / source buttons. Replace the whole template string assigned to `root.innerHTML`:

```ts
  root.innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <button class="dir-name" id="dir-name" title=""><i class="ph ph-folder"></i><span id="dir-label">-</span></button>
        <span class="sep">/</span>
        <button class="project-name" id="project-name" title="切换项目空间">
          <span id="project-label">-</span><i class="ph ph-caret-down"></i>
        </button>
        <div class="surface-seg" id="surface-seg">
          <button class="seg-btn active" data-surface="inbox">Inbox</button>
          <button class="seg-btn" data-surface="piece">成品</button>
        </div>
      </div>
      <div class="piece-mount" id="piece-mount"></div>
      <div class="topbar-right">
        <button class="icon-btn" id="tasks-toggle" title="清单"><i class="ph ph-list-checks"></i></button>
        <button class="icon-btn" id="split-toggle" title="分屏（Inbox ｜ 成品）"><i class="ph ph-columns"></i></button>
        <button class="src-toggle icon-btn" id="src-toggle" title="切换源码 / 卡片"><i class="ph ph-cards"></i></button>
        <button class="new-btn" id="new-btn" title="新建项目"><i class="ph ph-plus"></i></button>
      </div>
    </div>
  `;

  root.querySelector<HTMLElement>("#dir-name")!.onclick = callbacks.onPickDir;

  const projectButton = root.querySelector<HTMLElement>("#project-name")!;
  projectButton.onclick = () => callbacks.onToggleProjects(projectButton);

  root.querySelector<HTMLElement>("#src-toggle")!.onclick = callbacks.onToggleSource;
  root.querySelector<HTMLElement>("#split-toggle")!.onclick = callbacks.onToggleSplit;
  root.querySelector<HTMLElement>("#tasks-toggle")!.onclick = callbacks.onToggleTasks;

  root.querySelectorAll<HTMLElement>(".seg-btn").forEach((btn) => {
    btn.onclick = () =>
      callbacks.onSelectSurface(btn.dataset.surface as "inbox" | "piece");
  });

  root.querySelector<HTMLElement>("#new-btn")!.onclick = () =>
    callbacks.onNewProject(projectButton);
```

Add setters at the end of `topbar.ts`:

```ts
export function setSurfaceSeg(surface: "inbox" | "piece") {
  document.querySelectorAll<HTMLElement>(".seg-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.surface === surface);
  });
}

export function setSplitToggle(active: boolean) {
  document.querySelector<HTMLElement>("#split-toggle")!.classList.toggle("on", active);
}

export function setTasksToggle(open: boolean) {
  document.querySelector<HTMLElement>("#tasks-toggle")!.classList.toggle("on", open);
}

export function pieceMount(): HTMLElement {
  return document.querySelector<HTMLElement>("#piece-mount")!;
}
```

- [ ] **Step 3: Add the 成品 column + editor to `main.ts` markup and state**

In `src/note/main.ts`, update `app.innerHTML` `#note-body` to add `#piece-col`:

```ts
  <div id="note-body">
    <div id="left-col"></div>
    <div id="text-col">
      <div id="editor-root"></div>
      <div id="inbox-root"></div>
    </div>
    <div id="piece-col">
      <div id="piece-editor-root"></div>
    </div>
    <div id="assistant-region"></div>
  </div>
```

Update topbar import:

```ts
import {
  renderTitlebar,
  renderTopbar,
  setDirLabel,
  setProjectLabel,
  setSourceToggle,
  setSurfaceSeg,
  setSplitToggle,
  setTasksToggle,
  pieceMount,
} from "./topbar";
```

Add imports for the piece switcher + tasks panel + list/create/rename helpers:

```ts
import { createPieceSwitcher } from "./piece-switcher";
import { createTasksPanel } from "./tasks-panel";
import { listPieces, createNote, renameNote } from "./notes-state";
import { piecesPath } from "./notes-state";
```

(Note: `listPieces`, `createNote`, `renameNote` already exist in `notes-state.ts`; only add names actually used here — keep this import list aligned with usage to avoid `tsc` unused errors. `piecesPath` is added in Step 4 below.)

- [ ] **Step 4: Add helpers to `notes-state.ts`**

In `src/note/notes-state.ts`, add a piece entry helper near `inboxEntry`:

```ts
export const TASKS_FILE = "_tasks.md";

/** Join a project folder path with a child file, OS-correct separator. */
export function projectFilePath(projectPath: string, file: string): string {
  const sep = projectPath.includes("\\") ? "\\" : "/";
  const trimmed = projectPath.replace(/[\\/]+$/, "");
  return `${trimmed}${sep}${file}`;
}

export function tasksPath(projectPath: string): string {
  return projectFilePath(projectPath, TASKS_FILE);
}
```

(Remove the now-redundant `piecesPath` import line from Step 3 — it was a placeholder; use `projectFilePath` / `tasksPath`. Keep `inboxPath` as is.)

- [ ] **Step 5: Wire the second editor + surface state in `main.ts`**

After the existing inbox editor + `inboxView` block in `main.ts`, add the 成品 editor and surface state. Insert after the `inboxView` definition:

```ts
// ── 成品 surface ──────────────────────────────────────────────────────────
const pieceEditorRoot = document.querySelector<HTMLElement>("#piece-editor-root")!;
let currentPiece: NoteEntry | null = null;

const pieceEditor = createEditor(pieceEditorRoot, (doc) => {
  if (applyingRemote) return;
  if (currentPiece) scheduleSave(currentPiece.path, doc);
});
requestAnimationFrame(() => initScrollbar(pieceEditorRoot));

// 焦点跟随：哪个 surface 获得焦点，助手 active_note 就指向它（成品=润色面）。
pieceEditor.contentDOM.addEventListener("focus", () => {
  if (currentProject && currentPiece) {
    void invoke("set_active_note", {
      dir: currentProject.path,
      noteId: currentPiece.name,
      path: currentPiece.path,
    });
  }
});
editor.contentDOM.addEventListener("focus", () => publishInboxActive());

const pieceSwitcher = createPieceSwitcher(pieceMount(), {
  dir: () => currentProject?.path ?? "",
  current: () => currentPiece,
  open: (entry) => void openPiece(entry),
});

async function openPiece(entry: NoteEntry) {
  currentPiece = entry;
  pieceSwitcher.setLabel(entry.name);
  setDoc(pieceEditor, await readNote(entry.path));
}

async function loadFirstPiece() {
  const dir = currentProject!.path;
  const pieces = await listPieces(dir);
  const first = pieces[0] ?? (await createNote(dir));
  await openPiece(first);
}

function publishInboxActive() {
  if (!currentProject || !current) return;
  void invoke("set_active_note", {
    dir: currentProject.path,
    noteId: current.entry.name,
    path: current.entry.path,
  });
}

// 单栏可见面 + 分屏请求。
type Surface = "inbox" | "piece";
let surface: Surface = "inbox";

function applySurface() {
  const split = layoutController?.isSplit() ?? false;
  // 分屏时 Inbox 恒在左、成品恒在右；单栏时按 surface 选一个。
  app.classList.toggle("show-piece", !split && surface === "piece");
  app.classList.toggle("show-inbox", split || surface === "inbox");
  setSurfaceSeg(surface);
}
```

Add `NoteEntry` to the `notes-state` type import in `main.ts` (it already imports `CurrentNote`, `ProjectEntry`):

```ts
  type CurrentNote,
  type NoteEntry,
  type ProjectEntry,
```

- [ ] **Step 6: Load piece on project open**

In `openProject`, after `inboxView.render(...)`, also load the project's first piece:

```ts
  await loadFirstPiece();
```

- [ ] **Step 7: Wire topbar callbacks + tasks panel + split**

Replace the `renderTopbar({...})` call's callbacks object to add the new ones:

```ts
renderTopbar(document.querySelector("#topbar-root")!, {
  onPickDir: pickDir,
  onToggleProjects: (anchor) => {
    void showProjectSwitcher(anchor);
  },
  onNewProject: (anchor) => {
    void showProjectSwitcher(anchor, true);
  },
  onToggleSource: toggleSource,
  onSelectSurface: (next) => {
    surface = next;
    applySurface();
  },
  onToggleSplit: () => {
    splitOn = !splitOn;
    layoutController?.setSplit(splitOn);
    setSplitToggle(layoutController?.isSplit() ?? false);
    applySurface();
  },
  onToggleTasks: () => tasksPanel.toggle(),
});

let splitOn = false;
const tasksPanel = createTasksPanel(noteBody, {
  tasksPath: () => (currentProject ? tasksPath(currentProject.path) : null),
  onOpenChange: (open) => setTasksToggle(open),
});
```

(Place `let splitOn` and `const tasksPanel` declarations *before* the `renderTopbar` call so the callbacks can close over them — hoisting note: move these two lines above `renderTopbar`.)

- [ ] **Step 8: Re-apply surface after layout changes + on resize**

In the `window.addEventListener("resize", ...)` handler, after `layoutController?.apply();` add:

```ts
  setSplitToggle(layoutController?.isSplit() ?? false);
  applySurface();
```

And at the end of `init()`, after `applyInboxMode();`, add `applySurface();` and refresh the tasks panel binding for the first project:

```ts
  applySurface();
```

- [ ] **Step 9: Reload tasks panel + piece label on project switch**

In `openProject`, after `await loadFirstPiece();`, refresh the tasks panel for the new project:

```ts
  tasksPanel.reload();
```

- [ ] **Step 10: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (tasks-panel created in Task 7; if running tasks out of order, Task 7 must land first — implement Task 7 before this type-check).

- [ ] **Step 11: Commit**

```bash
git add src/note/main.ts src/note/topbar.ts src/note/piece-switcher.ts src/note/notes-state.ts src/styles.css
git commit -m "feat(piece): second editor, piece switcher, surface + split state"
```

---

## Task 7: 清单 panel (`tasks-panel.ts`)

**Files:**
- Create: `src/note/tasks-panel.ts`
- Modify: `src/styles.css`

A toggleable overlay panel bound to the current project's `_tasks.md`: render todo rows, check (`- [x]` → strikethrough), add a new task. Reads/writes the file directly via `readNote` / `write_note`.

- [ ] **Step 1: Create the tasks panel**

Create `src/note/tasks-panel.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { readNote } from "./notes-state";
import { addTask, parseTasks, serializeTasks, toggleTask, type TaskLine } from "./tasks";

export interface TasksPanelHost {
  /** 当前项目的 _tasks.md 路径，无项目时 null。 */
  tasksPath: () => string | null;
  /** 面板开/关时回调（驱动顶栏按钮高亮）。 */
  onOpenChange: (open: boolean) => void;
}

export function createTasksPanel(parent: HTMLElement, host: TasksPanelHost) {
  let open = false;
  let items: TaskLine[] = [];

  const panel = document.createElement("div");
  panel.className = "tasks-panel";
  panel.style.display = "none";
  panel.innerHTML = `
    <div class="tasks-head">清单</div>
    <div class="tasks-list"></div>
    <form class="tasks-add">
      <input class="tasks-input" placeholder="添加下一步…" />
    </form>
  `;
  parent.appendChild(panel);

  const listEl = panel.querySelector<HTMLElement>(".tasks-list")!;
  const form = panel.querySelector<HTMLFormElement>(".tasks-add")!;
  const input = panel.querySelector<HTMLInputElement>(".tasks-input")!;

  async function persist() {
    const path = host.tasksPath();
    if (!path) return;
    await invoke("write_note", { path, content: serializeTasks(items) });
  }

  function draw() {
    listEl.replaceChildren();
    items.forEach((item, index) => {
      if (item.kind !== "todo") return;
      const row = document.createElement("label");
      row.className = "tasks-row";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = item.checked;
      box.onchange = () => {
        items = toggleTask(items, index);
        void persist();
        draw();
      };
      const text = document.createElement("span");
      text.className = "tasks-text";
      if (item.checked) text.classList.add("done");
      text.textContent = item.text || "（空任务）";
      row.append(box, text);
      listEl.appendChild(row);
    });
    if (!items.some((i) => i.kind === "todo")) {
      const empty = document.createElement("div");
      empty.className = "tasks-empty";
      empty.textContent = "还没有下一步。";
      listEl.appendChild(empty);
    }
  }

  form.onsubmit = (e) => {
    e.preventDefault();
    items = addTask(items, input.value);
    input.value = "";
    void persist();
    draw();
  };

  async function reload() {
    const path = host.tasksPath();
    items = path ? parseTasks(await readNote(path)) : [];
    draw();
  }

  function toggle() {
    open = !open;
    panel.style.display = open ? "flex" : "none";
    host.onOpenChange(open);
    if (open) void reload();
  }

  return { toggle, reload };
}
```

- [ ] **Step 2: Add tasks-panel + segmented + icon-button styles**

Append to `src/styles.css`:

```css
/* 顶栏分段切换 Inbox / 成品 */
.surface-seg {
  display: inline-flex;
  margin-left: 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 7px;
  overflow: hidden;
}

.seg-btn {
  padding: 3px 10px !important;
  border: none;
  background: transparent;
  color: #6b7280;
  cursor: pointer;
  border-radius: 0 !important;
}

.seg-btn.active {
  background: rgba(0, 0, 0, 0.06);
  color: #111827;
  font-weight: 500;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.icon-btn {
  width: 32px;
  height: 32px;
  justify-content: center;
  border-radius: 50% !important;
}

.icon-btn:hover {
  background: rgba(0, 0, 0, 0.06) !important;
}

.icon-btn.on {
  background: rgba(37, 99, 235, 0.12) !important;
  color: #2563eb;
}

/* 成品名药丸挂载点（居中），复用 .note-name 样式 */
.piece-mount {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  display: none;
}

#app.show-piece .piece-mount,
#app.split-active .piece-mount {
  display: block;
}

/* 成品栏可见性：单栏 segmented 选成品时占满 text-col（借用 piece-col 显隐切换） */
#piece-editor-root {
  position: absolute;
  inset: 0;
  overflow: auto;
  background: #fff;
}

/* 单栏显示成品：把成品编辑器搬到 text-col 上方覆盖（inbox 藏） */
#app.show-piece:not(.split-active) #text-col #editor-root,
#app.show-piece:not(.split-active) #text-col #inbox-root {
  display: none;
}

/* 清单浮层面板 */
.tasks-panel {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  width: 260px;
  max-height: 60%;
  padding: 10px 12px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}

.tasks-head {
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #6b7280;
}

.tasks-list {
  flex: 1;
  overflow: auto;
}

.tasks-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  font-size: 14px;
}

.tasks-text.done {
  color: #9ca3af;
  text-decoration: line-through;
}

.tasks-empty {
  padding: 12px 2px;
  color: #9ca3af;
  font-size: 13px;
}

.tasks-add {
  margin-top: 6px;
}

.tasks-input {
  width: 100%;
  padding: 5px 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 7px;
  font-size: 13px;
  outline: none;
}

@media (prefers-color-scheme: dark) {
  .seg-btn.active { background: rgba(255, 255, 255, 0.1); color: #f3f4f6; }
  .icon-btn:hover { background: rgba(255, 255, 255, 0.08) !important; }
  .icon-btn.on { background: rgba(96, 165, 250, 0.2) !important; color: #60a5fa; }
  #piece-editor-root { background: #1e1e1e; }
  .tasks-panel { background: #262626; border-color: rgba(255, 255, 255, 0.12); }
  .tasks-input { background: #1e1e1e; color: #e5e7eb; border-color: rgba(255, 255, 255, 0.14); }
}
```

- [ ] **Step 3: Type-check + full unit tests**

Run: `npx tsc --noEmit && npm test`
Expected: PASS — tsc clean; all suites green including `split` (4), `tasks` (8), `piece-name` (6), plus existing `blocks/*`, `layout`, `notes-state`, `append`, `versions`.

- [ ] **Step 4: Commit**

```bash
git add src/note/tasks-panel.ts src/styles.css
git commit -m "feat(tasks): toggleable 清单 panel bound to _tasks.md"
```

---

## Task 8: Build + manual verification

**Files:** none (verification only)

- [ ] **Step 1: Build**

Run: `npm run build`
Expected: PASS — `tsc` clean, Vite bundles both entry pages.

- [ ] **Step 2: cargo check (backend)**

Run (from `src-tauri/`): `cargo check`
Expected: PASS.

- [ ] **Step 3: Run the app and verify**

Run: `npm run tauri dev`

Verify, in order:
1. **成品 switcher:** the centered piece pill shows the current 成品 (default `piece`). Opening it lists all pieces; "新建成品" creates and switches to a fresh `.md`; "重命名当前" renames in place (file + versions move; `_`-prefixed input is rejected to a non-`_` name).
2. **Single-pane segmented:** the [Inbox｜成品] control swaps the surface filling the text column; the source toggle still flips the Inbox between cards and raw source.
3. **Split:** widen the window, click the split toggle → Inbox left, 成品 right; the assistant drops to the floating corner. Narrow the window past the two-pane minimum → split auto-collapses back to single-pane segmented (toggle stays "off" visually).
4. **清单:** the checklist toggle opens a panel reading the current project's `_tasks.md`; adding a task writes `- [ ]`; checking writes `- [x]` and strikes through; switching projects reloads the panel; the panel shows only the current project.
5. **Capture:** ⌥⌘C while reading drops a `> [!quote]` callout card into the **current project's Inbox**, regardless of which surface is focused; the file on disk shows the callout.
6. **Assistant target:** focusing the 成品 editor then asking the assistant to edit acts on the 成品 file; focusing Inbox targets `_inbox.md`.

- [ ] **Step 4: Final commit (only if verification needed tweaks)**

```bash
git add -A
git commit -m "chore(project-spaces): plans 4-7 verification tweaks"
```

---

## Self-Review

- **Spec coverage:**
  - 成品 "笔记切换器…切换、新建、直接重命名" → Task 6 (`piece-switcher.ts`) + Task 2 (sanitize). ✅
  - 清单 "可开 / 关的独立小面板，只看本项目…就地添加、打勾、划掉" → Tasks 3 + 7. ✅
  - 布局 "宽窗顶栏出现分屏 → Inbox 左 ｜ 成品 右；窄到放不下自动收回单栏" → Tasks 1 + 5. ✅
  - "分屏 = 用成品栏换掉内嵌助手的位置；助手落回 Floating（零新增状态）" → Task 5 `applySplit` forces floating; Task 6 surface state. ✅
  - 捕获 "落入当前项目的 _inbox.md，作为一个新剪藏块（callout，带来源）" → Task 4 `format_clip`; capture already targets the inbox editor. ✅
  - Non-goals respected: no 提炼, no global Inbox, no cross-project 清单 (panel binds to current `_tasks.md` only), no three-column ultra-wide (assistant floats in split), no legacy migration. ✅
- **Placeholder scan:** every code step shows full code; Task 6 Step 3 flags a placeholder import (`piecesPath`) and Step 4 explicitly corrects it to `projectFilePath`/`tasksPath`. The only conditional commit (Task 8 Step 4) is marked skip-if-unchanged.
- **Type consistency:** `NoteEntry` from `notes-state.ts` is the piece type across `piece-switcher.ts` and `main.ts`; `TaskLine` defined in `tasks.ts` (Task 3) is consumed by `tasks-panel.ts` (Task 7); `SplitLayout`/`SPLIT_PREFS` (Task 1) consumed by `layout-controller.ts` (Task 5); controller's new `setSplit`/`isSplit` (Task 5) called from `main.ts` (Task 6); topbar setters `setSurfaceSeg`/`setSplitToggle`/`setTasksToggle`/`pieceMount` (Task 6 Step 2) imported in `main.ts` (Task 6 Step 3).
- **Ordering caveat:** Task 7 (`tasks-panel.ts`) must be implemented before Task 6's `tsc` (Step 10) passes, since `main.ts` imports it. Implement 1→2→3→4→5→7→6→8, or accept a transient red tsc between 6 and 7.
- **Architecture invariant:** each editor owns one file's autosave (inbox path vs piece path); capture always appends to the inbox editor; `set_active_note` follows focus. No change to the version-snapshot or agent-protocol wiring.
```
