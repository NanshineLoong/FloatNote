# 笔记窗内快捷键 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为笔记窗增加一套窗口内键盘快捷键（AI 助手/气泡/行动/视图/新对话 + Esc 关闭链 + 字号），并在设置页提供自定义录制与冲突检测。

**Architecture:** 前端中央 `document` keydown 监听（`src/note/shortcuts.ts`）+ 共享纯函数模块（`src/shared/shortcuts.ts`，设置页与笔记窗共用）。键位存 Rust `Config.window_shortcuts`（`#[serde(default)]`），`apply_shortcuts` 落盘并 emit `window-shortcuts-changed` 事件热重载。所有窗内快捷键纯前端，不动 global-shortcut/capabilities。

**Tech Stack:** TypeScript ES modules、Vitest（node 环境，无 jsdom——DOM 逻辑用纯函数抽取测试 + 源码串断言）、Tauri 2（Rust serde、`app.emit`）、CodeMirror 6。

## Global Constraints

- 修饰键统一 `e.metaKey || e.ctrlKey`（mac=Cmd，Win=Ctrl），与现有字号逻辑一致。
- 跨平台：路径分隔符/OS 键不假设；系统保留键 `Mod+Q/W/M/H/N/R` 不可分配。
- 不改 `src-tauri/capabilities/default.json`、不改 `src-tauri/src/shortcuts.rs` 全局注册、不新增 Tauri global shortcut。
- 默认键位（不可在实现中改动）：助手 `Cmd+J`、气泡 `Cmd+B`、行动 `Cmd+T`、添加 `Cmd+G`、新对话 `Cmd+K`、视图 `Cmd+1/2/3`、字号 `Cmd+= / - / 0`、取消 `Esc`。
- 编码风格：两空格缩进、双引号、分号、camelCase；Rust 用 `rustfmt` + snake_case。
- 提交信息用短祈使句，可带 `feat:`/`refactor:`/`test:` 前缀，末行带 `Co-Authored-By: Claude <noreply@anthropic.com>`。

---

## File Structure

- Create `src/shared/shortcuts.ts` — 纯函数：`eventToCombo`、`canonicalize`、`WINDOW_SHORTCUT_*`、`RESERVED`、`checkConflict`、`findAllConflicts`。设置页 + 笔记窗共用。
- Create `src/shared/shortcuts.test.ts` — 上述纯函数单测。
- Create `src/note/shortcuts.ts` — 中央分派：`buildBindings`、`resolveEsc`、`resolveBoundCombo`、`viewTargetFor`、`installShortcuts`。纯函数可测 + 薄 DOM 包装。
- Create `src/note/shortcuts.test.ts` — `resolveEsc`/`resolveBoundCombo`/`viewTargetFor`/`buildBindings` 单测。
- Modify `src/settings/key-recorder.ts` — 复用 `eventToCombo`、新增 `onChange` 回调。
- Modify `src/assistant/render.ts` — 导出 `isChatStreaming`。
- Modify `src/assistant/render.test.ts` — `isChatStreaming` 测试。
- Modify `src/assistant/assistant.ts` — `AssistantHandle` 增补方法、`AssistantDeps.send` 返回 requestId、新增 `cancel` dep、追踪 `activeRequestId`、移除 document Esc 监听（迁入中央）。
- Modify `src/assistant/assistant-ui.test.ts` — 更新 Esc 断言（移到中央）。
- Modify `src/note/tasks-panel.ts` — 返回值增补 `quickAdd`。
- Modify `src/note/main.ts` — 删字号 keydown、装配 `installShortcuts`、监听热重载事件、接线 actions、`selectView` 抽函数、`bumpFont`。
- Modify `src/settings/main.ts` — 新增"窗口快捷键"区块（8 录制器 + 冲突提示 + 恢复默认）、保存传 `windowShortcuts`。
- Modify `src-tauri/src/config.rs` — `WindowShortcuts` 结构 + `Config.window_shortcuts` 字段 + 默认值 + 测试。
- Modify `src-tauri/src/commands.rs` — `apply_shortcuts` 扩展入参 + 落盘 + emit；新增 `get_window_shortcuts`。
- Modify `src-tauri/src/lib.rs` — 注册 `get_window_shortcuts`。

---

### Task 1: 共享快捷键纯函数模块

**Files:**
- Create: `src/shared/shortcuts.ts`
- Test: `src/shared/shortcuts.test.ts`

**Interfaces:**
- Produces: `WindowShortcutId`、`WINDOW_SHORTCUT_IDS`、`WINDOW_SHORTCUT_DEFAULTS`、`WINDOW_SHORTCUT_LABELS`、`eventToCombo(e: KeyboardEvent): string | null`、`canonicalize(combo: string): string`、`checkConflict(input): ConflictResult | null`、`findAllConflicts(all, globals)`。后续任务（2/5/8）依赖这些签名。

- [ ] **Step 1: 写失败测试**

Create `src/shared/shortcuts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  canonicalize,
  checkConflict,
  findAllConflicts,
  eventToCombo,
  WINDOW_SHORTCUT_DEFAULTS,
  WINDOW_SHORTCUT_IDS,
  type WindowShortcutId,
} from "./shortcuts";

function fakeKey(key: string, mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean }): KeyboardEvent {
  return { key, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, altKey: !!mods.alt } as KeyboardEvent;
}

describe("eventToCombo", () => {
  it("产出 Cmd/Ctrl+主键 格式；无修饰键或仅修饰键返回 null", () => {
    expect(canonicalize(eventToCombo(fakeKey("j", { meta: true }))!)).toBe("Mod+J");
    expect(canonicalize(eventToCombo(fakeKey("b", { ctrl: true }))!)).toBe("Mod+B");
    expect(eventToCombo(fakeKey("j", {}))).toBeNull();
    expect(eventToCombo(fakeKey("Shift", { shift: true }))).toBeNull();
  });
  it("保留 Shift/Alt", () => {
    expect(canonicalize(eventToCombo(fakeKey("k", { meta: true, shift: true }))!)).toBe("Shift+Mod+K");
    expect(canonicalize(eventToCombo(fakeKey("1", { meta: true }))!)).toBe("Mod+1");
  });
});

describe("canonicalize", () => {
  it("Cmd/Win/Ctrl/Meta 归一为 Mod，字母大写", () => {
    expect(canonicalize("Cmd+J")).toBe("Mod+J");
    expect(canonicalize("Ctrl+j")).toBe("Mod+J");
    expect(canonicalize("Win+J")).toBe("Mod+J");
  });
  it("修饰键顺序统一为 Shift,Alt,Mod", () => {
    expect(canonicalize("Cmd+Shift+U")).toBe("Shift+Mod+U");
    expect(canonicalize("Alt+Cmd+C")).toBe("Alt+Mod+C");
  });
  it("符号与功能键原样", () => {
    expect(canonicalize("Cmd+=")).toBe("Mod+=");
    expect(canonicalize("Cmd+-")).toBe("Mod+-");
    expect(canonicalize("Cmd+0")).toBe("Mod+0");
    expect(canonicalize("Cmd+/")).toBe("Mod+/");
    expect(canonicalize("Cmd+Enter")).toBe("Mod+Enter");
  });
});

describe("checkConflict", () => {
  const globals = { capture: "Alt+Cmd+C", toggle: "Alt+Cmd+N", popup: "Alt+Cmd+P" };
  const all = () => ({ ...WINDOW_SHORTCUT_DEFAULTS });

  it("保留键：Mod+A 与全选冲突", () => {
    const r = checkConflict({ combo: "Cmd+A", id: "assistant", all: all(), globals });
    expect(r?.kind).toBe("reserved");
    expect(r?.message).toContain("全选");
  });
  it("保留键：Mod+W 系统关窗", () => {
    const r = checkConflict({ combo: "Cmd+W", id: "assistant", all: all(), globals });
    expect(r?.kind).toBe("reserved");
    expect(r?.message).toContain("关闭窗口");
  });
  it("保留键：Mod+= 字号", () => {
    const r = checkConflict({ combo: "Cmd+=", id: "assistant", all: all(), globals });
    expect(r?.kind).toBe("reserved");
    expect(r?.message).toContain("字号");
  });
  it("保留键：Shift+Mod+K（CM 占用）", () => {
    const r = checkConflict({ combo: "Cmd+Shift+K", id: "assistant", all: all(), globals });
    expect(r?.kind).toBe("reserved");
  });
  it("窗内重复：与另一项相同", () => {
    const a = all();
    a.action_panel = "Cmd+J"; // 与 assistant 默认相同
    const r = checkConflict({ combo: "Cmd+J", id: "action_panel", all: a, globals });
    expect(r?.kind).toBe("window");
    expect(r?.message).toContain("切换 AI 助手");
  });
  it("撞全局快捷键", () => {
    const r = checkConflict({ combo: "Alt+Cmd+C", id: "assistant", all: all(), globals });
    expect(r?.kind).toBe("global");
    expect(r?.message).toContain("划线引用");
  });
  it("合法组合返回 null", () => {
    expect(checkConflict({ combo: "Cmd+J", id: "assistant", all: all(), globals })).toBeNull();
  });
  it("不与自身重复", () => {
    const r = checkConflict({ combo: "Cmd+J", id: "assistant", all: all(), globals });
    expect(r).toBeNull();
  });
});

describe("findAllConflicts", () => {
  it("无冲突时返回空对象", () => {
    expect(Object.keys(findAllConflicts({ ...WINDOW_SHORTCUT_DEFAULTS }, {
      capture: "Alt+Cmd+C", toggle: "Alt+Cmd+N", popup: "Alt+Cmd+P",
    }))).toHaveLength(0);
  });
  it("标记所有冲突项", () => {
    const all = { ...WINDOW_SHORTCUT_DEFAULTS, action_panel: "Cmd+J" }; // 撞 assistant
    const r = findAllConflicts(all, { capture: "Alt+Cmd+C", toggle: "Alt+Cmd+N", popup: "Alt+Cmd+P" });
    expect(r.assistant?.kind).toBe("window");
    expect(r.action_panel?.kind).toBe("window");
  });
});

describe("defaults", () => {
  it("8 项默认值齐备", () => {
    expect(WINDOW_SHORTCUT_IDS).toHaveLength(8);
    for (const id of WINDOW_SHORTCUT_IDS) {
      expect(typeof WINDOW_SHORTCUT_DEFAULTS[id as WindowShortcutId]).toBe("string");
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run src/shared/shortcuts.test.ts`
Expected: FAIL（`Cannot find module './shortcuts'`）

- [ ] **Step 3: 写实现**

Create `src/shared/shortcuts.ts`:

```ts
/**
 * 快捷键共享纯函数：键位默认值、KeyboardEvent→组合串、归一化、冲突检测。
 * 设置页（录制+冲突提示）与笔记窗（中央分派）共用，避免逻辑重复。
 */

const isMac =
  typeof navigator !== "undefined" && navigator.platform
    ? navigator.platform.toUpperCase().indexOf("MAC") >= 0
    : false;

export type WindowShortcutId =
  | "assistant"
  | "assistant_bubble"
  | "action_panel"
  | "add_action"
  | "new_conversation"
  | "view_inbox"
  | "view_piece"
  | "view_split";

export const WINDOW_SHORTCUT_IDS: WindowShortcutId[] = [
  "assistant",
  "assistant_bubble",
  "action_panel",
  "add_action",
  "new_conversation",
  "view_inbox",
  "view_piece",
  "view_split",
];

export const WINDOW_SHORTCUT_DEFAULTS: Record<WindowShortcutId, string> = {
  assistant: "Cmd+J",
  assistant_bubble: "Cmd+B",
  action_panel: "Cmd+T",
  add_action: "Cmd+G",
  new_conversation: "Cmd+K",
  view_inbox: "Cmd+1",
  view_piece: "Cmd+2",
  view_split: "Cmd+3",
};

export const WINDOW_SHORTCUT_LABELS: Record<WindowShortcutId, string> = {
  assistant: "切换 AI 助手",
  assistant_bubble: "切换 AI 对话气泡",
  action_panel: "切换行动面板",
  add_action: "添加下一项行动",
  new_conversation: "新对话",
  view_inbox: "视图·采集",
  view_piece: "视图·写作",
  view_split: "视图·双栏",
};

function keyName(key: string): string {
  switch (key) {
    case "Meta": return isMac ? "Cmd" : "Win";
    case "Control": return "Ctrl";
    case "Alt": return "Alt";
    case "Shift": return "Shift";
    case " ": return "Space";
    default: return key.length === 1 ? key.toUpperCase() : key;
  }
}

/** KeyboardEvent → "Cmd+J" 格式；无修饰键或仅修饰键按下返回 null。 */
export function eventToCombo(e: KeyboardEvent): string | null {
  if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return null;
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push(isMac ? "Cmd" : "Win");
  if (mods.length === 0) return null;
  mods.push(keyName(e.key));
  return mods.join("+");
}

/** "Cmd+J" → "Mod+J"（Cmd/Win/Ctrl/Meta 归一 Mod，字母大写，修饰键顺序 Shift,Alt,Mod）。 */
export function canonicalize(combo: string): string {
  const mods = new Set<string>();
  let main = "";
  for (const part of combo.split("+")) {
    if (part === "Cmd" || part === "Win" || part === "Ctrl" || part === "Meta") {
      mods.add("Mod");
    } else if (part === "Alt") {
      mods.add("Alt");
    } else if (part === "Shift") {
      mods.add("Shift");
    } else {
      main = part.length === 1 ? part.toUpperCase() : part;
    }
  }
  const out: string[] = [];
  for (const m of ["Shift", "Alt", "Mod"]) {
    if (mods.has(m)) out.push(m);
  }
  if (main) out.push(main);
  return out.join("+");
}

interface ReservedEntry {
  combo: string;
  reason: string;
}

const RAW_RESERVED: ReservedEntry[] = [
  // CodeMirror defaultKeymap + historyKeymap 占用（实测 editor.ts:50）
  { combo: "Mod+A", reason: "与编辑器「全选」冲突" },
  { combo: "Mod+I", reason: "与编辑器快捷键冲突" },
  { combo: "Mod+U", reason: "与编辑器「选区撤销」冲突" },
  { combo: "Mod+Shift+U", reason: "与编辑器「选区重做」冲突" },
  { combo: "Mod+Y", reason: "与编辑器「重做」冲突" },
  { combo: "Mod+Z", reason: "与编辑器「撤销」冲突" },
  { combo: "Mod+Shift+Z", reason: "与编辑器「重做」冲突" },
  { combo: "Mod+[", reason: "与编辑器「减少缩进」冲突" },
  { combo: "Mod+]", reason: "与编辑器「增加缩进」冲突" },
  { combo: "Mod+/", reason: "与编辑器「注释」冲突" },
  { combo: "Mod+Enter", reason: "与编辑器快捷键冲突" },
  { combo: "Shift+Mod+K", reason: "与编辑器快捷键冲突" },
  // 系统/平台保留
  { combo: "Mod+Q", reason: "与系统「退出」冲突" },
  { combo: "Mod+W", reason: "与系统「关闭窗口」冲突" },
  { combo: "Mod+M", reason: "与系统「最小化」冲突" },
  { combo: "Mod+H", reason: "与系统「隐藏」冲突" },
  { combo: "Mod+N", reason: "与系统「新窗口」冲突" },
  { combo: "Mod+R", reason: "与系统「刷新」冲突" },
  // 复制粘贴
  { combo: "Mod+C", reason: "与「复制」冲突" },
  { combo: "Mod+V", reason: "与「粘贴」冲突" },
  { combo: "Mod+X", reason: "与「剪切」冲突" },
  // 应用固定项
  { combo: "Mod+=", reason: "与「字号放大」冲突" },
  { combo: "Mod+-", reason: "与「字号缩小」冲突" },
  { combo: "Mod+0", reason: "与「字号复位」冲突" },
];

const RESERVED_MAP = new Map<string, string>(
  RAW_RESERVED.map((r) => [canonicalize(r.combo), r.reason]),
);

export interface ConflictInput {
  combo: string;
  id: WindowShortcutId;
  all: Record<WindowShortcutId, string>;
  globals: { capture: string; toggle: string; popup: string };
}

export interface ConflictResult {
  kind: "reserved" | "window" | "global";
  message: string;
}

export function checkConflict(input: ConflictInput): ConflictResult | null {
  const c = canonicalize(input.combo);
  const reserved = RESERVED_MAP.get(c);
  if (reserved) return { kind: "reserved", message: reserved };
  for (const id of WINDOW_SHORTCUT_IDS) {
    if (id === input.id) continue;
    if (input.all[id] && canonicalize(input.all[id]) === c) {
      return { kind: "window", message: `与「${WINDOW_SHORTCUT_LABELS[id]}」重复` };
    }
  }
  const labels: Array<[string, string]> = [
    [input.globals.capture, "划线引用"],
    [input.globals.toggle, "显示/隐藏"],
    [input.globals.popup, "划词弹窗"],
  ];
  for (const [combo, label] of labels) {
    if (combo && canonicalize(combo) === c) {
      return { kind: "global", message: `与全局快捷键「${label}」重复（窗口聚焦时会双重触发）` };
    }
  }
  return null;
}

export function findAllConflicts(
  all: Record<WindowShortcutId, string>,
  globals: { capture: string; toggle: string; popup: string },
): Partial<Record<WindowShortcutId, ConflictResult>> {
  const out: Partial<Record<WindowShortcutId, ConflictResult>> = {};
  for (const id of WINDOW_SHORTCUT_IDS) {
    const r = checkConflict({ combo: all[id], id, all, globals });
    if (r) out[id] = r;
  }
  return out;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- --run src/shared/shortcuts.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: 提交**

```bash
git add src/shared/shortcuts.ts src/shared/shortcuts.test.ts
git commit -m "$(cat <<'EOF'
feat: shared shortcut helpers (combo parse, canonicalize, conflict check)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: KeyRecorder 复用 eventToCombo + onChange 回调

**Files:**
- Modify: `src/settings/key-recorder.ts`
- Modify: `src/note/main.ts`（无——本任务仅改 KeyRecorder）

**Interfaces:**
- Consumes: `eventToCombo` from Task 1.
- Produces: `KeyRecorder` 构造签名 `(el, initialValue, onChange?)`；`onChange?: () => void` 在值变化后调用。Task 8 依赖 `onChange` 做实时冲突检测。

- [ ] **Step 1: 改写 keydown 处理复用 eventToCombo，并加 onChange**

Replace the `keydown` listener inside `bindEvents()` of `src/settings/key-recorder.ts` (lines 72-101) with:

```ts
    this.el.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") {
        this.stopRecording();
        return;
      }

      if (!this.recording) return;

      const combo = eventToCombo(e);
      if (combo === null) {
        this.labelEl.textContent = "需要修饰键 (Ctrl/Alt/Shift/Cmd)…";
        return;
      }
      this._value = combo;
      this.stopRecording();
      this.onChange?.();
    });
```

Add the import at top of `src/settings/key-recorder.ts`:

```ts
import { eventToCombo } from "../shared/shortcuts";
```

Add the `onChange` property + constructor param. Replace the constructor (lines 32-41) with:

```ts
  private readonly el: HTMLElement;
  private labelEl: HTMLElement;
  private _value: string;
  private recording = false;
  private readonly onChange?: () => void;

  constructor(el: HTMLElement, initialValue: string, onChange?: () => void) {
    this.el = el;
    this._value = initialValue;
    this.onChange = onChange;

    // 确保内部结构
    this.labelEl = el.querySelector(".key-recorder-label") ?? el;

    this.render();
    this.bindEvents();
  }
```

（删除文件内原有的 `keyName` 函数与 `isMac` 常量——其逻辑已由 `eventToCombo` 承担。）

- [ ] **Step 2: 确认设置页现有三处 `new KeyRecorder(el, value)` 仍编译**

Run: `npx tsc --noEmit`
Expected: PASS（第三参数可选，现有两参调用兼容）

- [ ] **Step 3: 跑全量测试确认无回归**

Run: `npm test`
Expected: PASS（KeyRecorder 无直接单测；其余测试不受影响）

- [ ] **Step 4: 提交**

```bash
git add src/settings/key-recorder.ts
git commit -m "$(cat <<'EOF'
refactor: KeyRecorder reuses eventToCombo, add onChange callback

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: render.ts 导出 isChatStreaming

**Files:**
- Modify: `src/assistant/render.ts`
- Test: `src/assistant/render.test.ts`

**Interfaces:**
- Produces: `isChatStreaming(state: ChatState): boolean`。Task 4 的 `AssistantHandle.isStreaming()` 依赖此函数。

- [ ] **Step 1: 写失败测试**

Append to `src/assistant/render.test.ts`（文件已存在，末尾追加）:

```ts
import { isChatStreaming, emptyChat, reduceEvents } from "./render";

describe("isChatStreaming", () => {
  it("空状态不流式", () => {
    expect(isChatStreaming(emptyChat())).toBe(false);
  });
  it("pending 事件后处于流式", () => {
    let s = reduceEvents(emptyChat(), { type: "user", text: "hi" });
    s = reduceEvents(s, { type: "pending" });
    expect(isChatStreaming(s)).toBe(true);
  });
  it("done 事件后停止流式", () => {
    let s = reduceEvents(emptyChat(), { type: "user", text: "hi" });
    s = reduceEvents(s, { type: "pending" });
    s = reduceEvents(s, { type: "delta", requestId: "r1", text: "x" });
    s = reduceEvents(s, { type: "done", requestId: "r1" });
    expect(isChatStreaming(s)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run src/assistant/render.test.ts`
Expected: FAIL（`isChatStreaming is not exported`）

- [ ] **Step 3: 写实现**

在 `src/assistant/render.ts` 的 `emptyChat` 之后添加：

```ts
/** 当前是否正在流式输出（存在 streaming 的 assistant 气泡）。 */
export function isChatStreaming(state: ChatState): boolean {
  return state.messages.some((m) => m.role === "assistant" && m.streaming);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- --run src/assistant/render.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/assistant/render.ts src/assistant/render.test.ts
git commit -m "$(cat <<'EOF'
feat: export isChatStreaming helper

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 扩展 AssistantHandle（暴露气泡/流式/取消/历史浮层方法）

**Files:**
- Modify: `src/assistant/assistant.ts`
- Modify: `src/assistant/assistant-ui.test.ts`

**Interfaces:**
- Consumes: `isChatStreaming` from Task 3；`agentSend` 返回 `Promise<string>`（requestId，见 `src/note/agent.ts:48-49`）。
- Produces: `AssistantHandle` 新增 `setInputOpen(open)`、`isInputOpen()`、`isStreaming()`、`cancel()`、`startNewConversation()`、`isHistoryPopoverOpen()`、`closeHistoryPopover()`；`AssistantDeps` 新增 `cancel?: (requestId: string) => void`、`send` 返回 `Promise<string>`。Task 7 依赖这些方法接线 actions。

- [ ] **Step 1: 更新 assistant-ui.test.ts 的 Esc 断言（Esc 将迁入中央）**

在 `src/assistant/assistant-ui.test.ts` 找到 `it("closes the history popover from outside clicks and Escape", ...)`，将其改为只断言 pointerdown（Esc 由 `src/note/shortcuts.ts` 中央处理）：

```ts
  it("closes the history popover from outside clicks", () => {
    expect(assistantSource).toContain('document.addEventListener("pointerdown"');
  });
```

并在该 describe 块内新增一条断言，确认 handle 暴露了中央所需方法：

```ts
  it("exposes handle methods for the central shortcut dispatcher", () => {
    expect(assistantSource).toContain("setInputOpen");
    expect(assistantSource).toContain("isInputOpen");
    expect(assistantSource).toContain("isStreaming");
    expect(assistantSource).toContain("isHistoryPopoverOpen");
    expect(assistantSource).toContain("closeHistoryPopover");
    expect(assistantSource).toContain("startNewConversation");
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run src/assistant/assistant-ui.test.ts`
Expected: FAIL（`isInputOpen` / `isHistoryPopoverOpen` 等未出现在源码）

- [ ] **Step 3: 改 AssistantDeps 类型（send 返回 requestId、新增 cancel）**

在 `src/assistant/assistant.ts` 顶部 `AssistantDeps` 接口（第 20-34 行）中，把 `send` 改为返回 `Promise<string>`，并新增 `cancel`：

```ts
export interface AssistantDeps {
  /** 发送一条用户消息给 tutor，返回 requestId（用于取消）。 */
  send: (text: string, conversationId: string) => Promise<string>;
  createConversation: (scope: ChatScope) => Promise<ChatConversation>;
  openConversation: (conversation: ChatConversation) => Promise<ChatConversation | null | void>;
  listConversations: (scope: ChatScope) => Promise<ChatConversation[]>;
  getLastConversation: (scope: ChatScope) => Promise<ChatConversation | null>;
  updateTitle: (
    conversationId: string,
    title: string,
    titleState: ChatConversation["titleState"],
  ) => Promise<ChatConversation | null>;
  /** 订阅 agent 流式事件；返回取消订阅句柄。 */
  subscribe: (cb: (event: AgentEvent) => void) => UnlistenFn | Promise<UnlistenFn>;
  /** 取消进行中的请求（经 stdin 发 Cancel）。无活动请求时 no-op。 */
  cancel?: (requestId: string) => void;
}
```

- [ ] **Step 4: 扩展 AssistantHandle 接口**

把 `AssistantHandle` 接口（第 36-42 行）改为：

```ts
export interface AssistantHandle {
  destroy: () => void;
  setScope: (scope: ChatScope | null) => void;
  openConversation: (conversation: ChatConversation) => Promise<void>;
  showError: (message: string) => void;
  /** 展开/收起输入气泡。 */
  setInputOpen: (open: boolean) => void;
  /** 输入气泡是否展开。 */
  isInputOpen: () => boolean;
  /** AI 是否正在流式输出。 */
  isStreaming: () => boolean;
  /** 取消进行中的 AI 回复（焦点在助手区且流式时由 Esc 调用）。 */
  cancel: () => void;
  /** 开始新对话（连带展开气泡）。 */
  startNewConversation: () => void;
  /** 历史浮层是否打开。 */
  isHistoryPopoverOpen: () => boolean;
  /** 关闭历史浮层。 */
  closeHistoryPopover: () => void;
}
```

- [ ] **Step 5: 追踪 activeRequestId + 在 submit/subscribe 中维护**

在 `mountAssistant` 内（`let inputOpen = false;` 附近，约第 108 行之前）新增：

```ts
  let activeRequestId: string | null = null;
```

在 `submit()` 内把 `await deps.send(text, conversation.id);`（约第 163 行）改为捕获 requestId：

```ts
      try {
        activeRequestId = await deps.send(text, conversation.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        dispatch({ type: "error", requestId: null, conversationId: conversation.id, message });
      }
```

在 subscribe 回调（约第 275-288 行）中，于 `dispatch(event)` 之前插入 requestId 维护：

```ts
  Promise.resolve(deps.subscribe((event) => {
    if (event.type === "session_opened") {
      state = reduceEvents(state, event);
      rerender();
      return;
    }
    if (event.type === "title" && activeConversation?.id === event.conversationId) {
      activeConversation = { ...activeConversation, title: event.title, titleState: "final" };
    }
    if (event.type === "delta" || event.type === "tool") {
      activeRequestId = event.requestId;
    } else if (event.type === "done" || event.type === "error") {
      activeRequestId = null;
    }
    dispatch(event);
  })).then((un) => {
```

- [ ] **Step 6: 移除 document Esc 监听（迁入中央）**

删除 `onDocumentKeyDown` 函数（第 263-265 行）及其注册/注销：

```ts
  // 删除整段：
  // function onDocumentKeyDown(e: KeyboardEvent) {
  //   if (e.key === "Escape") closeHistoryPopover();
  // }
  // document.addEventListener("keydown", onDocumentKeyDown);
```

并在 `destroy()`（约第 290-298 行）中删除对应 `document.removeEventListener("keydown", onDocumentKeyDown);` 一行。保留 `pointerdown` 监听。

- [ ] **Step 7: 在返回的 handle 对象中暴露新方法**

把 `return { ... }`（约第 290-324 行）改为：

```ts
  return {
    destroy() {
      destroyed = true;
      unlisten?.();
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      root.classList.remove("assistant");
      root.innerHTML = "";
    },
    setScope(scope: ChatScope | null) {
      currentScope = scope;
      setActiveConversation(null);
      closeHistoryPopover();
      state = emptyChat();
      rerender();
      const token = ++scopeToken;
      if (!scope) return;
      void deps.getLastConversation(scope)
        .then(async (conversation) => {
          if (token !== scopeToken) return;
          if (!conversation) return;
          setActiveConversation(conversation);
          await deps.openConversation(conversation);
        })
        .catch((err) => {
          if (token !== scopeToken) return;
          const message = err instanceof Error ? err.message : String(err);
          dispatch({ type: "error", requestId: null, message });
        });
    },
    openConversation,
    showError(message: string) {
      dispatch({ type: "error", requestId: null, message });
    },
    setInputOpen,
    isInputOpen() {
      return inputOpen;
    },
    isStreaming() {
      return isChatStreaming(state);
    },
    cancel() {
      if (activeRequestId) deps.cancel?.(activeRequestId);
    },
    startNewConversation() {
      void startNewConversation();
    },
    isHistoryPopoverOpen() {
      return !historyPopover.hidden;
    },
    closeHistoryPopover,
  };
```

在文件顶部 import 中加入 `isChatStreaming`：

```ts
import {
  type ChatEvent,
  type ChatState,
  emptyChat,
  isChatStreaming,
  reduceEvents,
  renderMessages,
} from "./render";
```

- [ ] **Step 8: 运行测试确认通过**

Run: `npm test -- --run src/assistant/assistant-ui.test.ts src/assistant/render.test.ts`
Expected: PASS

- [ ] **Step 9: tsc 全量**

Run: `npx tsc --noEmit`
Expected: PASS（`send` 返回类型变更可能让 main.ts 的接线需要调整——本任务暂不动 main.ts；若 tsc 报 main.ts:455 `send` 返回值未使用，属正常，Task 7 会接线。若报错非预期，检查是否仅与 send 返回值相关。）

- [ ] **Step 10: 提交**

```bash
git add src/assistant/assistant.ts src/assistant/assistant-ui.test.ts
git commit -m "$(cat <<'EOF'
feat: expose assistant handle methods (bubble/streaming/cancel/history) for shortcuts

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 中央快捷键分派模块

**Files:**
- Create: `src/note/shortcuts.ts`
- Test: `src/note/shortcuts.test.ts`

**Interfaces:**
- Consumes: `eventToCombo`、`canonicalize`、`WindowShortcutId` from Task 1。
- Produces: `Bindings`、`buildBindings`、`EscContext`、`EscAction`、`resolveEsc`、`resolveBoundCombo`、`viewTargetFor`、`ShortcutActions`、`installShortcuts`。Task 7 依赖 `installShortcuts`/`buildBindings`/`ShortcutActions`。

- [ ] **Step 1: 写失败测试**

Create `src/note/shortcuts.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildBindings,
  resolveEsc,
  resolveBoundCombo,
  viewTargetFor,
} from "./shortcuts";
import { WINDOW_SHORTCUT_DEFAULTS, type WindowShortcutId } from "../shared/shortcuts";

describe("buildBindings + resolveBoundCombo", () => {
  const bindings = buildBindings({ ...WINDOW_SHORTCUT_DEFAULTS });
  it("命中默认键", () => {
    expect(resolveBoundCombo("Cmd+J", bindings)).toBe("assistant");
    expect(resolveBoundCombo("Ctrl+J", bindings)).toBe("assistant"); // Ctrl≡Cmd
    expect(resolveBoundCombo("Cmd+1", bindings)).toBe("view_inbox");
  });
  it("未命中返回 null", () => {
    expect(resolveBoundCombo("Cmd+Z", bindings)).toBeNull();
    expect(resolveBoundCombo(null, bindings)).toBeNull();
  });
});

describe("viewTargetFor", () => {
  it("双栏在窄窗回落写作", () => {
    expect(viewTargetFor("view_split", true)).toBe("split");
    expect(viewTargetFor("view_split", false)).toBe("piece");
  });
  it("采集/写作直达", () => {
    expect(viewTargetFor("view_inbox", false)).toBe("inbox");
    expect(viewTargetFor("view_piece", false)).toBe("piece");
  });
  it("非视图项返回 null", () => {
    expect(viewTargetFor("assistant", true)).toBeNull();
  });
});

describe("resolveEsc 优先级链", () => {
  const base = {
    historyPopoverOpen: false,
    focusInAssistant: false,
    streaming: false,
    actionPanelOpen: false,
    bubbleOpen: false,
  };
  it("1. 历史浮层最优先", () => {
    expect(
      resolveEsc({ ...base, historyPopoverOpen: true, actionPanelOpen: true, bubbleOpen: true }),
    ).toBe("closeHistoryPopover");
  });
  it("2. 焦点在助手+流式 → 取消回复（优先于行动面板）", () => {
    expect(
      resolveEsc({ ...base, focusInAssistant: true, streaming: true, actionPanelOpen: true }),
    ).toBe("cancelAssistant");
  });
  it("流式但焦点不在助手 → 不取消，落到行动面板", () => {
    expect(
      resolveEsc({ ...base, focusInAssistant: false, streaming: true, actionPanelOpen: true }),
    ).toBe("closeActionPanel");
  });
  it("3. 行动面板开 → 关面板（优先于气泡）", () => {
    expect(
      resolveEsc({ ...base, actionPanelOpen: true, bubbleOpen: true }),
    ).toBe("closeActionPanel");
  });
  it("4. 气泡展开 → 收起", () => {
    expect(resolveEsc({ ...base, bubbleOpen: true })).toBe("collapseBubble");
  });
  it("5. 全关 → null", () => {
    expect(resolveEsc(base)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run src/note/shortcuts.test.ts`
Expected: FAIL（`Cannot find module './shortcuts'`）

- [ ] **Step 3: 写实现**

Create `src/note/shortcuts.ts`:

```ts
import { canonicalize, eventToCombo, type WindowShortcutId } from "../shared/shortcuts";

/**
 * 笔记窗中央快捷键分派：唯一一个 document keydown 监听，
 * 分派可绑定组合（助手/气泡/行动/视图/新对话）+ Esc 优先级链 + 字号固定项。
 * 纯函数（resolveEsc/resolveBoundCombo/viewTargetFor）可单测；installShortcuts 是薄 DOM 包装。
 */

export interface Bindings {
  /** canonical combo → action id */
  map: Map<string, WindowShortcutId>;
}

export function buildBindings(values: Record<WindowShortcutId, string>): Bindings {
  const map = new Map<string, WindowShortcutId>();
  for (const id of Object.keys(values) as WindowShortcutId[]) {
    map.set(canonicalize(values[id]), id);
  }
  return { map };
}

export function resolveBoundCombo(combo: string | null, bindings: Bindings): WindowShortcutId | null {
  if (!combo) return null;
  return bindings.map.get(canonicalize(combo)) ?? null;
}

export function viewTargetFor(
  id: WindowShortcutId,
  canSplit: boolean,
): "inbox" | "piece" | "split" | null {
  if (id === "view_inbox") return "inbox";
  if (id === "view_piece") return "piece";
  if (id === "view_split") return canSplit ? "split" : "piece";
  return null;
}

export interface EscContext {
  historyPopoverOpen: boolean;
  focusInAssistant: boolean;
  streaming: boolean;
  actionPanelOpen: boolean;
  bubbleOpen: boolean;
}

export type EscAction =
  | "closeHistoryPopover"
  | "cancelAssistant"
  | "closeActionPanel"
  | "collapseBubble";

export function resolveEsc(ctx: EscContext): EscAction | null {
  if (ctx.historyPopoverOpen) return "closeHistoryPopover";
  if (ctx.focusInAssistant && ctx.streaming) return "cancelAssistant";
  if (ctx.actionPanelOpen) return "closeActionPanel";
  if (ctx.bubbleOpen) return "collapseBubble";
  return null;
}

export interface ShortcutActions {
  toggleAssistant(): void;
  toggleAssistantBubble(): void;
  toggleActionPanel(): void;
  quickAddAction(): void;
  selectView(v: "inbox" | "piece" | "split"): void;
  startNewConversation(): void;
  isAssistantStreaming(): boolean;
  cancelAssistant(): void;
  isActionPanelOpen(): boolean;
  closeActionPanel(): void;
  isAssistantBubbleOpen(): boolean;
  collapseAssistantBubble(): void;
  isHistoryPopoverOpen(): boolean;
  closeHistoryPopover(): void;
  canSplit(): boolean;
  bumpFont(delta: number): void; // +1 / -1 / 0 复位
}

function isFocusInAssistant(): boolean {
  const el = document.activeElement;
  return el instanceof Element && !!el.closest("#assistant-region");
}

function runBound(id: WindowShortcutId, a: ShortcutActions): void {
  switch (id) {
    case "assistant": a.toggleAssistant(); break;
    case "assistant_bubble": a.toggleAssistantBubble(); break;
    case "action_panel": a.toggleActionPanel(); break;
    case "add_action": a.quickAddAction(); break;
    case "new_conversation": a.startNewConversation(); break;
    case "view_inbox": a.selectView("inbox"); break;
    case "view_piece": a.selectView("piece"); break;
    case "view_split": a.selectView(viewTargetFor("view_split", a.canSplit()) ?? "piece"); break;
  }
}

function runEsc(act: EscAction, a: ShortcutActions): void {
  switch (act) {
    case "closeHistoryPopover": a.closeHistoryPopover(); break;
    case "cancelAssistant": a.cancelAssistant(); break;
    case "closeActionPanel": a.closeActionPanel(); break;
    case "collapseBubble": a.collapseAssistantBubble(); break;
  }
}

export function installShortcuts(actions: ShortcutActions, bindings: Bindings): () => void {
  const handler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      const act = resolveEsc({
        historyPopoverOpen: actions.isHistoryPopoverOpen(),
        focusInAssistant: isFocusInAssistant(),
        streaming: actions.isAssistantStreaming(),
        actionPanelOpen: actions.isActionPanelOpen(),
        bubbleOpen: actions.isAssistantBubbleOpen(),
      });
      if (act) {
        e.preventDefault();
        runEsc(act, actions);
      }
      return;
    }
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      actions.bumpFont(1);
      return;
    }
    if (e.key === "-") {
      e.preventDefault();
      actions.bumpFont(-1);
      return;
    }
    if (e.key === "0") {
      e.preventDefault();
      actions.bumpFont(0);
      return;
    }
    const id = resolveBoundCombo(eventToCombo(e), bindings);
    if (id) {
      e.preventDefault();
      runBound(id, actions);
    }
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- --run src/note/shortcuts.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/note/shortcuts.ts src/note/shortcuts.test.ts
git commit -m "$(cat <<'EOF'
feat: central note-window shortcut dispatcher (bindings, Esc chain, font)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Rust 配置 WindowShortcuts + 命令

**Files:**
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: Rust `WindowShortcuts` 结构（snake_case 字段，`#[serde(default)]`）；`apply_shortcuts` 新签名含 `window_shortcuts: WindowShortcuts`（JS 传 `windowShortcuts`）并 emit `window-shortcuts-changed`；新命令 `get_window_shortcuts`。Task 7/8 依赖。

- [ ] **Step 1: config.rs 增 WindowShortcuts 结构 + 字段 + 默认 + 测试**

在 `src-tauri/src/config.rs` 的 `Config` 结构前新增结构：

```rust
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(default)]
pub struct WindowShortcuts {
    pub assistant: String,
    pub assistant_bubble: String,
    pub action_panel: String,
    pub add_action: String,
    pub new_conversation: String,
    pub view_inbox: String,
    pub view_piece: String,
    pub view_split: String,
}

impl Default for WindowShortcuts {
    fn default() -> Self {
        WindowShortcuts {
            assistant: "Cmd+J".to_string(),
            assistant_bubble: "Cmd+B".to_string(),
            action_panel: "Cmd+T".to_string(),
            add_action: "Cmd+G".to_string(),
            new_conversation: "Cmd+K".to_string(),
            view_inbox: "Cmd+1".to_string(),
            view_piece: "Cmd+2".to_string(),
            view_split: "Cmd+3".to_string(),
        }
    }
}
```

在 `Config` 结构中（`shortcut_popup` 之后）新增字段：

```rust
    /// 笔记窗内快捷键（窗口聚焦时生效，纯前端分派）。默认值见 WindowShortcuts::default。
    pub window_shortcuts: WindowShortcuts,
```

在 `Config::default()` 中（`shortcut_popup` 行之后）新增：

```rust
            window_shortcuts: WindowShortcuts::default(),
```

在 `#[cfg(test)] mod tests` 末尾新增：

```rust
    #[test]
    fn window_shortcuts_default() {
        let c = Config::default();
        assert_eq!(c.window_shortcuts.assistant, "Cmd+J");
        assert_eq!(c.window_shortcuts.view_split, "Cmd+3");
    }

    #[test]
    fn partial_json_keeps_window_shortcuts_default() {
        let config: Config = serde_json::from_str(r#"{"font_size":20}"#).unwrap();
        assert_eq!(config.window_shortcuts.assistant, "Cmd+J");
    }
```

- [ ] **Step 2: commands.rs 扩展 apply_shortcuts + 新增 get_window_shortcuts**

在 `src-tauri/src/commands.rs` 顶部把 `use crate::{config::Config, ...}`（第 4 行）改为：

```rust
use crate::{config::{Config, WindowShortcuts}, notes, project, versions};
```

加 `Emitter` 到 tauri 导入（第 8 行 `use tauri::{Manager, State};`）：

```rust
use tauri::{Emitter, Manager, State};
```

替换 `apply_shortcuts`（第 391-399 行）为：

```rust
#[tauri::command]
pub fn apply_shortcuts(
    app: tauri::AppHandle,
    state: State<AppState>,
    capture: String,
    toggle: String,
    popup: String,
    window_shortcuts: WindowShortcuts,
) -> Result<(), String> {
    crate::shortcuts::apply(&app, &capture, &toggle, &popup)?;
    {
        let mut config = state.config.lock().unwrap();
        config.shortcut_capture = capture;
        config.shortcut_toggle = toggle;
        config.shortcut_popup = popup;
        config.window_shortcuts = window_shortcuts;
        crate::config::save(&state.config_path, &config).map_err(|error| error.to_string())?;
    }
    let _ = app.emit("window-shortcuts-changed", ());
    Ok(())
}
```

在 `get_assistant_state` 附近（`commands.rs:336` 之前或之后）新增：

```rust
/// 读取笔记窗内快捷键绑定（笔记窗初始化与热重载时调用）。
#[tauri::command]
pub fn get_window_shortcuts(state: State<AppState>) -> WindowShortcuts {
    state.config.lock().unwrap().window_shortcuts.clone()
}
```

- [ ] **Step 3: lib.rs 注册新命令**

在 `src-tauri/src/lib.rs` 的 `invoke_handler!` 列表中 `commands::apply_shortcuts,`（第 149 行）之后新增：

```rust
            commands::get_window_shortcuts,
```

- [ ] **Step 4: cargo check + 单测**

Run: `cd src-tauri && cargo check && cargo test --lib config`
Expected: PASS（编译通过；config 模块测试含新 window_shortcuts 用例）

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/config.rs src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
feat: persist window shortcuts in config + get_window_shortcuts command + hot-reload event

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 笔记窗装配 installShortcuts + 热重载 + actions 接线

**Files:**
- Modify: `src/note/main.ts`
- Modify: `src/note/tasks-panel.ts`（返回值增 `quickAdd`）

**Interfaces:**
- Consumes: `installShortcuts`/`buildBindings`/`ShortcutActions` from Task 5；`AssistantHandle` 新方法 from Task 4；`get_window_shortcuts` 命令 from Task 6；`canSplit` from `./split`。
- Produces: 笔记窗内完整快捷键生效。

- [ ] **Step 1: tasks-panel 暴露 quickAdd**

在 `src/note/tasks-panel.ts` 的 `createTasksPanel` 返回对象（第 511 行 `return { toggle, setOpen, isOpen, reload, syncLayout };`）中新增 `quickAdd`。先在 `isOpen` 函数后新增函数：

```ts
  /** 连带打开面板并聚焦添加表单（快捷键入口）。 */
  function quickAdd() {
    if (!open) setOpen(true);
    setAdding(true);
  }
```

改返回值为：

```ts
  return { toggle, setOpen, isOpen, reload, syncLayout, quickAdd };
```

- [ ] **Step 2: main.ts 顶部导入**

在 `src/note/main.ts` 顶部 import 区新增（`import { canSplit } from "./split";` 已在第 70 行存在，复用）：

```ts
import { buildBindings, installShortcuts, type ShortcutActions } from "./shortcuts";
import { WINDOW_SHORTCUT_DEFAULTS, type WindowShortcutId } from "../shared/shortcuts";
import { agentCancel } from "./agent";
```

- [ ] **Step 3: 删除旧字号 keydown 监听**

删除 `src/note/main.ts:1335-1347` 的整段 `document.addEventListener("keydown", (e) => { ... });`（字号 ±）。字号改由 `installShortcuts` 经 `bumpFont` 处理。

- [ ] **Step 4: 抽出 selectView 函数（供 topbar 回调与 actions 共用）**

在 `applyView()` 函数附近（第 414 行之前）新增：

```ts
function selectView(view: "inbox" | "piece" | "split") {
  if (view === "split") {
    layoutController?.setSplit(true);
  } else {
    surface = view;
    layoutController?.setSplit(false);
  }
  applyView();
  tasksPanel.syncLayout();
}
```

把 `renderTopbar` 的 `onSelectView` 回调（第 1278-1288 行）改为：

```ts
  onSelectView: (view) => {
    selectView(view);
  },
```

- [ ] **Step 5: 加 bumpFont + DEFAULT_FONT**

在 `applyFontSize`/`saveFontSize` 附近（第 1321-1333 行）把 `let currentFontSize = 15;` 之前加常量、之后加 `bumpFont`：

```ts
const FONT_MIN = 10;
const FONT_MAX = 28;
const DEFAULT_FONT = 15;
let currentFontSize = 15;

function applyFontSize(size: number) {
  currentFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, size));
  document.documentElement.style.setProperty("--editor-font", `${currentFontSize}px`);
}

async function saveFontSize() {
  const config = await getConfig();
  await invoke("set_config", { newConfig: { ...config, font_size: currentFontSize } });
}

/** 字号快捷键入口：+1/-1 调整，0 复位默认。 */
function bumpFont(delta: number) {
  applyFontSize(delta === 0 ? DEFAULT_FONT : currentFontSize + delta);
  void saveFontSize();
}
```

- [ ] **Step 6: 构造 actions 对象 + 装配 installShortcuts + 热重载监听**

在 `init()` 函数内（`const config = await getConfig();` `applyFontSize(config.font_size);` 之后，`bootstrapProjects` 之前或之后均可——需在 `layoutController` 创建之后，因为 actions 用到它）。建议放在 `layoutController.apply(); applyView();` 之后：

```ts
  // ── 窗内快捷键 ──
  let uninstallShortcuts: (() => void) | null = null;

  async function loadShortcuts() {
    const ws = await invoke<Record<WindowShortcutId, string>>("get_window_shortcuts");
    const values: Record<WindowShortcutId, string> = { ...WINDOW_SHORTCUT_DEFAULTS, ...ws };
    const bindings = buildBindings(values);
    if (uninstallShortcuts) uninstallShortcuts();
    uninstallShortcuts = installShortcuts(actions, bindings);
  }

  const actions: ShortcutActions = {
    toggleAssistant: async () => {
      const next = await invoke<{ open: boolean }>("toggle_assistant");
      layoutController?.setAssistantOpen(next.open);
      tasksPanel.syncLayout();
    },
    toggleAssistantBubble: async () => {
      const cur = await invoke<{ open: boolean }>("get_assistant_state");
      if (!cur.open) {
        const next = await invoke<{ open: boolean }>("toggle_assistant");
        layoutController?.setAssistantOpen(next.open);
        tasksPanel.syncLayout();
        assistantHandle.setInputOpen(true);
      } else {
        assistantHandle.setInputOpen(!assistantHandle.isInputOpen());
      }
    },
    toggleActionPanel: () => tasksPanel.toggle(),
    quickAddAction: () => tasksPanel.quickAdd(),
    selectView: (v) => selectView(v),
    startNewConversation: async () => {
      const cur = await invoke<{ open: boolean }>("get_assistant_state");
      if (!cur.open) {
        const next = await invoke<{ open: boolean }>("toggle_assistant");
        layoutController?.setAssistantOpen(next.open);
        tasksPanel.syncLayout();
      }
      assistantHandle.startNewConversation();
    },
    isAssistantStreaming: () => assistantHandle.isStreaming(),
    cancelAssistant: () => assistantHandle.cancel(),
    isActionPanelOpen: () => tasksPanel.isOpen(),
    closeActionPanel: () => tasksPanel.setOpen(false),
    isAssistantBubbleOpen: () => assistantHandle.isInputOpen(),
    collapseAssistantBubble: () => assistantHandle.setInputOpen(false),
    isHistoryPopoverOpen: () => assistantHandle.isHistoryPopoverOpen(),
    closeHistoryPopover: () => assistantHandle.closeHistoryPopover(),
    canSplit: () => canSplit(window.innerWidth),
    bumpFont,
  };

  await loadShortcuts();
  await listen("window-shortcuts-changed", () => { void loadShortcuts(); });
```

- [ ] **Step 7: 给 mountAssistant 的 deps 接 cancel，并修正 send 返回值使用**

在 `src/note/main.ts` 的 `mountAssistant(assistantRegion, { ... })`（第 450 行起）deps 对象中，`send` 已返回 `agentSend(...)`（`Promise<string>`），保持不变。在 `subscribe: (cb) => onAgentEvent(cb),` 之后新增：

```ts
  cancel: (requestId) => { void agentCancel(requestId); },
```

- [ ] **Step 8: tsc + 全量测试**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 9: 手动验证（npm run tauri dev）**

- `Cmd+J` 开/关助手；`Cmd+B` 连带开助手+展开气泡+聚焦输入；再按收起。
- `Cmd+T` 开/关行动面板；`Cmd+G` 连带开面板+聚焦添加表单，输入文字 Enter 落盘 `_tasks.md`。
- `Cmd+1/2/3` 切采集/写作/双栏；窄窗下 `Cmd+3` 落到写作。
- `Cmd+K` 新对话（连带开助手+气泡）。
- 流式中 + 焦点在助手输入 → `Esc` 取消回复；行动面板开 → `Esc` 关面板；气泡开（面板关）→ `Esc` 收气泡；历史浮层开 → `Esc` 关浮层。
- `Cmd+=/-/0` 字号放大/缩小/复位。
Expected: 各项行为符合 spec。Win 上 Ctrl 等价键同样。

- [ ] **Step 10: 提交**

```bash
git add src/note/main.ts src/note/tasks-panel.ts
git commit -m "$(cat <<'EOF'
feat: wire note-window shortcuts (toggles, Esc chain, font, hot-reload)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 设置页窗口快捷键区块 + 冲突检测

**Files:**
- Modify: `src/settings/main.ts`

**Interfaces:**
- Consumes: `KeyRecorder`（带 `onChange`，Task 2）；`WINDOW_SHORTCUT_*`、`findAllConflicts`、`checkConflict`（Task 1）；`apply_shortcuts` 新 `windowShortcuts` 入参（Task 6）。
- Produces: 设置页"窗口快捷键"区块：8 录制器 + 实时冲突提示 + 恢复默认 + 保存写入 config。

- [ ] **Step 1: 扩展 Config 接口**

在 `src/settings/main.ts` 的 `interface Config`（第 5-16 行）末尾新增字段：

```ts
  window_shortcuts: {
    assistant: string;
    assistant_bubble: string;
    action_panel: string;
    add_action: string;
    new_conversation: string;
    view_inbox: string;
    view_piece: string;
    view_split: string;
  };
```

- [ ] **Step 2: 顶部导入**

在 `src/settings/main.ts` 顶部 import 区新增：

```ts
import {
  WINDOW_SHORTCUT_IDS,
  WINDOW_SHORTCUT_DEFAULTS,
  WINDOW_SHORTCUT_LABELS,
  findAllConflicts,
  type WindowShortcutId,
} from "../shared/shortcuts";
```

- [ ] **Step 3: 在 HTML 模板的"快捷键"section 后插入"窗口快捷键"section**

在 `render()` 的模板字符串中，`<!-- ── 快捷键 ── -->` section 的闭合 `</section>`（第 81 行）之后、`<!-- ── AI 助手 ── -->` 之前插入：

```ts
      <!-- ── 窗口快捷键 ── -->
      <section class="settings-section">
        <div class="settings-section-header">
          <i class="ph ph-keyboard"></i>
          <span>窗口快捷键</span>
        </div>
        ${WINDOW_SHORTCUT_IDS.map((id) => `
        <div class="settings-row">
          <label class="settings-label">${WINDOW_SHORTCUT_LABELS[id]}</label>
          <div id="recorder-${id}" class="key-recorder" tabindex="0">
            <span class="key-recorder-label">${escapeHtml(config.window_shortcuts?.[id] ?? WINDOW_SHORTCUT_DEFAULTS[id])}</span>
          </div>
          <span class="settings-conflict" data-conflict-for="${id}"></span>
        </div>
        `).join("")}
        <div class="settings-row settings-row-inline">
          <button id="restore-shortcuts" class="settings-btn-ghost" type="button">恢复默认</button>
        </div>
      </section>
```

- [ ] **Step 4: 创建 8 个录制器 + recomputeConflicts**

在 `render()` 内现有 `popupRecorder` 创建之后（第 142 行后）新增：

```ts
  // ── 窗口快捷键录制器 ──
  const windowRecorders: Partial<Record<WindowShortcutId, KeyRecorder>> = {};
  for (const id of WINDOW_SHORTCUT_IDS) {
    const el = document.querySelector<HTMLElement>(`#recorder-${id}`)!;
    windowRecorders[id] = new KeyRecorder(el, config.window_shortcuts?.[id] ?? WINDOW_SHORTCUT_DEFAULTS[id], recomputeConflicts);
  }

  function recomputeConflicts() {
    const all = {} as Record<WindowShortcutId, string>;
    for (const id of WINDOW_SHORTCUT_IDS) {
      all[id] = windowRecorders[id]!.value;
    }
    const globals = { capture: captureRecorder.value, toggle: toggleRecorder.value, popup: popupRecorder.value };
    const conflicts = findAllConflicts(all, globals);
    let hasConflict = false;
    for (const id of WINDOW_SHORTCUT_IDS) {
      const span = document.querySelector<HTMLElement>(`[data-conflict-for="${id}"]`)!;
      const r = conflicts[id];
      if (r) {
        hasConflict = true;
        span.textContent = `⚠ ${r.message}`;
        span.classList.add("error");
      } else {
        span.textContent = "";
        span.classList.remove("error");
      }
    }
    // 全局录制器变化也可能引入冲突（window↔global），上面 findAllConflicts 已覆盖；
    // 这里再禁用保存。
    const saveBtn = document.querySelector<HTMLButtonElement>("#save-btn")!;
    saveBtn.disabled = hasConflict;
  }

  // 全局录制器变化也要重算（可能引入 window↔global 冲突）
  // KeyRecorder 已在 stopRecording 后调用 onChange，故三处全局录制器也接 recomputeConflicts：
  // （capturer/toggler/popupRecorder 在上面已用两参构造；改为三参加回调：）
```

> 注：上面全局三个录制器（`captureRecorder`/`toggleRecorder`/`popupRecorder`，第 131-142 行）创建时改用三参形式，第三参传 `recomputeConflicts`，使全局键变化也触发重算。把那三处 `new KeyRecorder(el, value)` 改为 `new KeyRecorder(el, value, recomputeConflicts)`。由于 `recomputeConflicts` 是函数声明（hoisted），可在其定义前引用。

把第 131-142 行三处录制器构造改为带第三参：

```ts
  const captureRecorder = new KeyRecorder(
    document.querySelector("#recorder-capture")!,
    config.shortcut_capture,
    recomputeConflicts,
  );
  const toggleRecorder = new KeyRecorder(
    document.querySelector("#recorder-toggle")!,
    config.shortcut_toggle,
    recomputeConflicts,
  );
  const popupRecorder = new KeyRecorder(
    document.querySelector("#recorder-popup")!,
    config.shortcut_popup,
    recomputeConflicts,
  );
```

并初始化时调一次：

```ts
  recomputeConflicts();
```

- [ ] **Step 5: 恢复默认按钮**

在 `render()` 内（`providerSelect.onchange` 附近）新增：

```ts
  document.querySelector<HTMLButtonElement>("#restore-shortcuts")!.onclick = () => {
    for (const id of WINDOW_SHORTCUT_IDS) {
      windowRecorders[id]!.value = WINDOW_SHORTCUT_DEFAULTS[id];
    }
    recomputeConflicts();
  };
```

- [ ] **Step 6: 保存流程传 windowShortcuts + 写入 newConfig**

把保存按钮 `onclick`（第 157 行起）中第 162-164 行的 `const capture/toggle/popup = ...Recorder.value;` 之后，新增收集 window 快捷键：

```ts
    const windowShortcuts = {} as Record<WindowShortcutId, string>;
    for (const id of WINDOW_SHORTCUT_IDS) {
      windowShortcuts[id] = windowRecorders[id]!.value;
    }
```

把 `await invoke("apply_shortcuts", { capture, toggle, popup });`（第 168 行）改为：

```ts
      await invoke("apply_shortcuts", { capture, toggle, popup, windowShortcuts });
```

把 `newConfig` 对象（第 176-186 行）末尾新增字段：

```ts
      window_shortcuts: windowShortcuts,
```

> 冲突时 Save 已被禁用（Step 4），故保存按钮不会触发；到达保存逻辑即无冲突。

- [ ] **Step 7: tsc + 全量测试**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 8: 手动验证（npm run tauri dev）**

打开设置页：
- 窗口快捷键区块显示 8 个录制器，初值为默认。
- 把"切换 AI 助手"录成 `Cmd+A` → 出现 `⚠ 与编辑器「全选」冲突`，Save 禁用。
- 把两个项录成相同组合 → 出现 `⚠ 与「…」重复`，Save 禁用。
- 把某项录成 `Alt+Cmd+C`（与全局划线引用相同）→ 出现全局冲突提示，Save 禁用。
- 改回合法组合 → 提示消失，Save 恢复。
- 点"恢复默认" → 8 项回到默认。
- 保存 → 笔记窗立即（无需重启）响应新键位（热重载）。
Expected: 全部符合。

- [ ] **Step 9: 提交**

```bash
git add src/settings/main.ts
git commit -m "$(cat <<'EOF'
feat: settings UI for window shortcuts with live conflict detection

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**1. Spec coverage:**
- 键位表（8 可绑 + Esc + 字号）→ Task 1（默认值/保留）、Task 5（分派/字号）、Task 6（默认落盘）、Task 7（装配）。
- Esc 优先级链 5 档 → Task 5 `resolveEsc` + 测试。
- 连带开上层（气泡/加行动/新对话）→ Task 7 actions（`toggleAssistantBubble`/`quickAddAction`/`startNewConversation` 先开助手/面板）。
- `canSplit` 回落 → Task 5 `viewTargetFor` + 测试。
- 模块结构（中央 shortcuts.ts + 共享 shared/shortcuts.ts + assistant 句柄）→ Task 1/4/5。
- 设置自定义 8 项 + 恢复默认 → Task 8。
- 冲突检测三类（保留/窗内/全局）硬错误 → Task 1 `checkConflict`/`findAllConflicts` + Task 8 接线 + Save 禁用。
- 持久化与热重载（config 字段 + apply_shortcuts emit + get_window_shortcuts + 监听）→ Task 6 + Task 7 `loadShortcuts`/`listen`。
- 跨平台修饰键、不动 capabilities/shortcuts.rs → Global Constraints + Task 6 仅加命令不改全局注册。
- 测试（分派/Esc/canSplit/冲突/canonicalize）→ Task 1/5 + render.isChatStreaming（Task 3）。

**2. Placeholder scan:** 无 TBD/TODO；每个代码步骤均给出完整代码与命令。

**3. Type consistency:**
- `WindowShortcutId` 在 Task 1 定义，Task 2/4/5/7/8 一致引用。
- `ShortcutActions`（Task 5）方法名与 Task 7 actions 实现逐一对应（`toggleAssistant`/`toggleAssistantBubble`/`toggleActionPanel`/`quickAddAction`/`selectView`/`startNewConversation`/`isAssistantStreaming`/`cancelAssistant`/`isActionPanelOpen`/`closeActionPanel`/`isAssistantBubbleOpen`/`collapseAssistantBubble`/`isHistoryPopoverOpen`/`closeHistoryPopover`/`canSplit`/`bumpFont`）。
- `AssistantHandle`（Task 4）方法名与 Task 7 调用一致（`setInputOpen`/`isInputOpen`/`isStreaming`/`cancel`/`startNewConversation`/`isHistoryPopoverOpen`/`closeHistoryPopover`）。
- `buildBindings`/`installShortcuts`（Task 5）与 Task 7 调用一致。
- `apply_shortcuts` Rust 参数 `window_shortcuts` ↔ JS `windowShortcuts`（Tauri 自动 camelCase）。
- `get_window_shortcuts` 返回 snake_case 字段 ↔ `Record<WindowShortcutId, string>`（id 字符串即 snake_case）。

无遗漏，类型一致。

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-note-window-shortcuts.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
