# 自动保存健壮性 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按业界最佳实践完善 FloatNote 笔记窗口的自动保存与外部变更同步：原子写入、per-path 防抖（修跨文件丢数据 bug）、mtime 冲突守卫、后台重试、关闭前 flush，并移除被取代的冗余代码。

**Architecture:** Rust 侧新增 `notes::write_atomic`（tempfile+fsync+rename）与 `NoteContent`/`WriteOutcome` 类型，集中替换四处 `std::fs::write` 并给 `write_note` 加 `expected_mtime` 守卫；前端 `notes-state.ts` 用 per-path `pending` Map 替换单全局 timer，串联 lastKnown mtime、冲突回调、退避重试与 `flushAll`；`main.ts`/`tasks-panel.ts` 接入新读写 API。

**Tech Stack:** Tauri 2 + Rust（`notify`、`std::fs`）、Vanilla TypeScript + Vite、Vitest。

## Global Constraints

- 工作目录：本 worktree（`/Users/nanshine/PlayGround/FloatNote/.claude/worktrees/autosave-robustness`），分支 `worktree-autosave-robustness`。所有命令在此目录运行。
- 代码风格：TypeScript 两空格缩进、双引号、分号、camelCase；Rust `rustfmt`、snake_case。
- 跨平台：原子 `rename` 需同盘（POSIX/Windows 均满足）；临时文件用 `.tmp` 后缀（非 `.md`，被 `watcher.rs:126` 的 `.md` 过滤忽略）；mtime 用 `SystemTime::duration_since(UNIX_EPOCH)` 毫秒。
- Tauri v2 命令参数自动 camelCase(JS) ↔ snake_case(Rust)：JS 传 `expectedMtime`，Rust 收 `expected_mtime`。
- 每个 Task 末尾 commit；commit message 末尾追加：
  ```
  Co-Authored-By: Claude <noreply@anthropic.com>
  ```
- 测试命令：前端 `npm test`（vitest run）、`npm run build`（tsc 类型检查 + 打包）；Rust `cargo check` 与 `cargo test --lib`（在 `src-tauri/` 下）。

## File Structure

- `src-tauri/src/notes.rs` — 新增 `write_atomic`、`mtime_millis`、`NoteContent`、`WriteOutcome` + 单测；职责：底层文件写入原语与笔记条目工具。
- `src-tauri/src/commands.rs` — `read_note`/`write_note`/`create_note`/`restore_version` 改用新类型与 `write_atomic`；职责：Tauri 命令薄封装。
- `src-tauri/src/agent.rs` — `apply_write` 改用 `write_atomic`；职责：sidecar 协议与 AI 写笔记。
- `src/note/notes-state.ts` — 重写保存调度（per-path pending Map、lastKnown、scheduleSave/saveImmediate/flushAll/onConflict/setLastKnown/discardPending/isDirty/loadNote/readNote）；职责：前端保存状态机。
- `src/note/notes-state.test.ts` — 扩展保存调度单测（mock invoke + fake timers）。
- `src/note/main.ts` — `readNote` 调用点改 `loadNote`；注册 `onConflict` 与 `flushAll` 钩子。
- `src/note/tasks-panel.ts` — `persist` 走 `saveImmediate`，`reload` 走 `loadNote`，移除裸 `invoke` 导入。

---

### Task 1: Rust `write_atomic` + `mtime_millis` 原语（TDD）

**Files:**
- Modify: `src-tauri/src/notes.rs`
- Test: `src-tauri/src/notes.rs`（`#[cfg(test)] mod tests`）

**Interfaces:**
- Produces:
  - `pub fn write_atomic(path: &Path, content: &str) -> std::io::Result<()>`
  - `pub fn mtime_millis(path: &Path) -> Option<u64>`

- [ ] **Step 1: 写失败测试**

在 `src-tauri/src/notes.rs` 的 `#[cfg(test)] mod tests` 内（`tempdir()` helper 之前插入）追加：

```rust
    #[test]
    fn write_atomic_replaces_content_and_leaves_no_tmp() {
        let dir = tempdir();
        let path = dir.path().join("note.md");
        std::fs::write(&path, "old").unwrap();
        write_atomic(&path, "new").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        let leftovers: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "tmp leftovers: {leftovers:?}");
    }

    #[test]
    fn write_atomic_creates_new_file() {
        let dir = tempdir();
        let path = dir.path().join("fresh.md");
        write_atomic(&path, "first").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");
    }

    #[test]
    fn write_atomic_errors_when_parent_missing() {
        let path = std::path::Path::new("/nonexistent-dir-xyz-aaa/note.md");
        assert!(write_atomic(path, "x").is_err());
    }

    #[test]
    fn mtime_millis_none_for_missing_file() {
        assert_eq!(mtime_millis(std::path::Path::new("/no/such/file.md")), None);
    }
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd src-tauri && cargo test --lib notes::`
Expected: 编译失败，`write_atomic` / `mtime_millis` 未定义。

- [ ] **Step 3: 实现 `write_atomic` 与 `mtime_millis`**

在 `src-tauri/src/notes.rs` 顶部 import 区（`use std::path::Path;` 同一区）改为：

```rust
use chrono::NaiveDateTime;
use serde::Serialize;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;
```

在 `delete_note` 函数之后、`#[cfg(test)]` 之前插入：

```rust
/// 进程级临时文件序号，保证并发写不撞名。
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// 原子写入：先写同目录临时文件（`.tmp` 后缀，watcher 与 list 均忽略）→
/// `sync_all` fsync → `rename` 原子替换目标。任一步失败都清理临时文件并返回错误，
/// 原文件不被破坏（rename 是同盘原子操作）。
pub fn write_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "note.md".to_string());
    let n = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!("{file_name}.{n}.tmp"));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(error);
    }

    if let Err(error) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error);
    }
    Ok(())
}

/// 取文件 `modified()` 的 UNIX_EPOCH 毫秒；文件不存在或不可读返回 None。
pub fn mtime_millis(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd src-tauri && cargo test --lib notes::`
Expected: PASS（含新增 4 项与原有 notes 测试）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/notes.rs
git commit -m "feat(notes): add write_atomic + mtime_millis primitives

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Rust 用 `write_atomic` 替换四处 `std::fs::write`（不改命令签名）

**Files:**
- Modify: `src-tauri/src/commands.rs:53-58` (`write_note`)、`commands.rs:60-84` (`create_note`)、`commands.rs:113-130` (`restore_version`)
- Modify: `src-tauri/src/agent.rs:370-380` (`apply_write`)

**Interfaces:**
- Consumes: `notes::write_atomic`（Task 1）
- Produces: 无新接口；`write_note`/`create_note`/`restore_version`/`apply_write` 内部改原子写，签名不变。

- [ ] **Step 1: 改 `write_note`**

`src-tauri/src/commands.rs:53-58`，将：

```rust
pub fn write_note(state: State<AppState>, path: String, content: String) -> Result<(), String> {
    crate::watcher::mark_self_write(&state.write_suppress, &path);
    std::fs::write(&path, &content).map_err(|error| error.to_string())?;
    Ok(())
}
```

改为：

```rust
pub fn write_note(state: State<AppState>, path: String, content: String) -> Result<(), String> {
    crate::watcher::mark_self_write(&state.write_suppress, &path);
    notes::write_atomic(std::path::Path::new(&path), &content).map_err(|error| error.to_string())?;
    Ok(())
}
```

- [ ] **Step 2: 改 `create_note`**

`commands.rs:79`，将 `std::fs::write(&path, "").map_err(|error| error.to_string())?;` 改为：

```rust
    notes::write_atomic(&path, "").map_err(|error| error.to_string())?;
```

- [ ] **Step 3: 改 `restore_version`**

`commands.rs:128`，将 `std::fs::write(&path, &restored).map_err(|error| error.to_string())?;` 改为：

```rust
    notes::write_atomic(std::path::Path::new(&path), &restored).map_err(|error| error.to_string())?;
```

- [ ] **Step 4: 改 `apply_write`**

`src-tauri/src/agent.rs:378`，将 `std::fs::write(path, new_content)?;` 改为：

```rust
    crate::notes::write_atomic(path, new_content)?;
```

- [ ] **Step 5: 编译 + 既有测试**

Run: `cd src-tauri && cargo check && cargo test --lib`
Expected: 编译通过；`agent::tests::apply_write_*` 等既有测试 PASS（`write_atomic` 与 `std::fs::write` 可观察行为一致）。

- [ ] **Step 6: 提交**

```bash
git add src-tauri/src/commands.rs src-tauri/src/agent.rs
git commit -m "refactor(notes): route note writes through write_atomic

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: 前端 per-path 防抖 + 重试 + flush（不含 mtime/冲突）

**说明：** 本任务先修跨文件丢数据 bug 与重试/flush，`readNote` 仍返回 `string`、`write_note` 仍返回 `()`；mtime/冲突在 Task 5 叠加。`pending` 结构预留 `expectedMtime` 由 Task 5 启用。

**Files:**
- Modify: `src/note/notes-state.ts:170-191`（重写保存调度）
- Test: `src/note/notes-state.test.ts`（追加）

**Interfaces:**
- Produces:
  - `export function scheduleSave(path: string, content: string): void`
  - `export async function saveImmediate(path: string, content: string, opts?: { force?: boolean }): Promise<void>`
  - `export function flushAll(): void`
  - `export function isDirty(path: string): boolean`
  - `export function onConflict(handler: (path: string, content: string) => void | Promise<void>): void`
  - `export function setLastKnown(path: string, mtime: number | null): void`
  - `export function discardPending(path: string): void`
  - `export function __resetSaveStateForTests(): void`

- [ ] **Step 1: 写失败测试**

在 `src/note/notes-state.test.ts` 顶部 import 行之后追加（与既有 `inboxPath` 测试共存）：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  scheduleSave,
  saveImmediate,
  flushAll,
  isDirty,
  onConflict,
  setLastKnown,
  discardPending,
  __resetSaveStateForTests,
} from "./notes-state";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockedInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const okWrite = (mtime: number | null = null) => ({ conflict: false, mtime });

describe("save scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedInvoke.mockReset();
    __resetSaveStateForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps per-path timers independent (regression: switching files no longer drops the first file)", async () => {
    mockedInvoke.mockResolvedValue(okWrite(1000));
    scheduleSave("/a.md", "A1");
    await vi.advanceTimersByTimeAsync(100);
    scheduleSave("/b.md", "B1");
    await vi.advanceTimersByTimeAsync(400); // A 的 500ms 到
    expect(mockedInvoke).toHaveBeenCalledWith("write_note", {
      path: "/a.md",
      content: "A1",
      expectedMtime: null,
    });
    expect(isDirty("/a.md")).toBe(false);
    expect(isDirty("/b.md")).toBe(true);
    await vi.advanceTimersByTimeAsync(100); // B 的 500ms 到
    expect(mockedInvoke).toHaveBeenCalledWith("write_note", {
      path: "/b.md",
      content: "B1",
      expectedMtime: null,
    });
    expect(isDirty("/b.md")).toBe(false);
  });

  it("coalesces rapid edits on the same path to the last content", async () => {
    mockedInvoke.mockResolvedValue(okWrite());
    scheduleSave("/a.md", "v1");
    await vi.advanceTimersByTimeAsync(150);
    scheduleSave("/a.md", "v2");
    await vi.advanceTimersByTimeAsync(150);
    scheduleSave("/a.md", "v3");
    await vi.advanceTimersByTimeAsync(500);
    const calls = mockedInvoke.mock.calls.filter((c) => c[0] === "write_note");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toMatchObject({ path: "/a.md", content: "v3" });
  });

  it("retries on io error with backoff and clears pending on eventual success", async () => {
    mockedInvoke.mockRejectedValueOnce(new Error("io")).mockResolvedValueOnce(okWrite(2000));
    scheduleSave("/a.md", "x");
    await vi.advanceTimersByTimeAsync(500); // 首次失败
    expect(isDirty("/a.md")).toBe(true);
    await vi.advanceTimersByTimeAsync(500); // 退避 1 后成功
    expect(isDirty("/a.md")).toBe(false);
  });

  it("saveImmediate writes without waiting for the debounce timer", async () => {
    mockedInvoke.mockResolvedValue(okWrite(3000));
    await saveImmediate("/a.md", "now");
    expect(mockedInvoke).toHaveBeenCalledWith("write_note", {
      path: "/a.md",
      content: "now",
      expectedMtime: null,
    });
    expect(isDirty("/a.md")).toBe(false);
  });

  it("flushAll flushes every pending path immediately", async () => {
    mockedInvoke.mockResolvedValue(okWrite());
    scheduleSave("/a.md", "A");
    scheduleSave("/b.md", "B");
    flushAll();
    await vi.advanceTimersByTimeAsync(0);
    expect(mockedInvoke).toHaveBeenCalledWith("write_note", {
      path: "/a.md",
      content: "A",
      expectedMtime: null,
    });
    expect(mockedInvoke).toHaveBeenCalledWith("write_note", {
      path: "/b.md",
      content: "B",
      expectedMtime: null,
    });
  });

  it("onConflict handler is called and pending retained when write reports conflict", async () => {
    mockedInvoke.mockResolvedValue({ conflict: true, mtime: null });
    const handler = vi.fn();
    onConflict(handler);
    scheduleSave("/a.md", "local");
    await vi.advanceTimersByTimeAsync(500);
    expect(handler).toHaveBeenCalledWith("/a.md", "local");
    expect(isDirty("/a.md")).toBe(true);
  });

  it("discardPending clears a path's pending state", async () => {
    mockedInvoke.mockResolvedValue(okWrite());
    scheduleSave("/a.md", "x");
    discardPending("/a.md");
    expect(isDirty("/a.md")).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- notes-state`
Expected: FAIL（`scheduleSave`/`saveImmediate`/`flushAll`/`onConflict`/`__resetSaveStateForTests` 等未导出，或行为不符）。

- [ ] **Step 3: 重写 `notes-state.ts` 保存调度**

先在文件顶部 import 区（`import { invoke } from "@tauri-apps/api/core";` 之后）追加类型：

```ts
/** read_note 命令返回：文件内容 + 磁盘 mtime（ms）。 */
export interface NoteContent {
  content: string;
  mtime: number | null;
}

/** write_note 命令返回：是否冲突 + 写入后的新 mtime。 */
export interface WriteOutcome {
  conflict: boolean;
  mtime: number | null;
}
```

然后将 `src/note/notes-state.ts:170-191`（从 `let saveTimer` 到文件末尾 `isDirty`）整体替换为：

```ts
interface PendingWrite {
  content: string;
  timer: ReturnType<typeof setTimeout> | null;
  retry: number;
}

const pending = new Map<string, PendingWrite>();
/** 最近一次已知磁盘 mtime（ms），用于写入时做冲突守卫。 */
const lastKnown = new Map<string, number | null>();
let conflictHandler:
  | ((path: string, content: string) => void | Promise<void>)
  | null = null;

const DEBOUNCE_MS = 500;
const MAX_RETRIES = 3;
const BACKOFF_MS = [500, 1000, 2000];

/** 登记某路径最近一次已知的磁盘 mtime（读盘/AI 改写后调用）。 */
export function setLastKnown(path: string, mtime: number | null): void {
  lastKnown.set(path, mtime);
}

/** 某路径是否有未保存的本地修改（外部文件变更时决定是否安全覆盖）。 */
export function isDirty(path: string): boolean {
  return pending.has(path);
}

/** 注册冲突处理器：写盘检测到外部已改动时回调。 */
export function onConflict(
  handler: (path: string, content: string) => void | Promise<void>,
): void {
  conflictHandler = handler;
}

/** 丢弃某路径的待保存状态（用户选择"保留磁盘版本"后调用）。 */
export function discardPending(path: string): void {
  const entry = pending.get(path);
  if (entry?.timer) clearTimeout(entry.timer);
  pending.delete(path);
}

/** 排一次防抖写入：500ms 尾沿，per-path 独立计时。连续编辑合并为最后一次内容。 */
export function scheduleSave(path: string, content: string): void {
  const prev = pending.get(path);
  if (prev?.timer) clearTimeout(prev.timer);
  pending.set(path, { content, timer: null, retry: 0 });
  const entry = pending.get(path)!;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void flushPath(path);
  }, DEBOUNCE_MS);
}

/** 立即写入（不经防抖计时）：tasks 面板与冲突"保留我的"用。 */
export async function saveImmediate(
  path: string,
  content: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const prev = pending.get(path);
  if (prev?.timer) clearTimeout(prev.timer);
  pending.set(path, { content, timer: null, retry: 0 });
  await flushPath(path, opts.force === true);
}

/** 关闭/隐藏前清空所有待保存：立即触发每条 pending 的写入（fire-and-forget）。 */
export function flushAll(): void {
  for (const [path, entry] of pending) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    void flushPath(path);
  }
}

/** 执行一次写入：取 expectedMtime → invoke → 处理 conflict/重试/续写。 */
async function flushPath(path: string, force = false): Promise<void> {
  const entry = pending.get(path);
  if (!entry) return;
  const contentWritten = entry.content;
  const expectedMtime = force ? null : (lastKnown.get(path) ?? null);
  try {
    const outcome = await invoke<WriteOutcome>("write_note", {
      path,
      content: contentWritten,
      expectedMtime,
    });
    if (outcome.conflict) {
      if (conflictHandler) {
        await conflictHandler(path, contentWritten);
      } else {
        console.error("save conflict (no handler registered)", path);
      }
      return;
    }
    lastKnown.set(path, outcome.mtime);
    const cur = pending.get(path);
    if (!cur) return;
    if (cur.content === contentWritten) {
      pending.delete(path);
    } else {
      // 写入期间又来了新编辑 → 重新排一次防抖写，避免新内容滞留。
      cur.retry = 0;
      if (cur.timer) clearTimeout(cur.timer);
      cur.timer = setTimeout(() => {
        cur.timer = null;
        void flushPath(path);
      }, DEBOUNCE_MS);
    }
  } catch (error) {
    console.error("save failed", error);
    const cur = pending.get(path);
    if (!cur) return;
    if (cur.retry < MAX_RETRIES) {
      const backoff = BACKOFF_MS[cur.retry] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      cur.retry += 1;
      if (cur.timer) clearTimeout(cur.timer);
      cur.timer = setTimeout(() => {
        cur.timer = null;
        void flushPath(path, force);
      }, backoff);
    }
    // 重试耗尽：保留 pending，下次 scheduleSave 会重置 retry 续写。
  }
}

/** 测试专用：清空保存状态（清计时、pending、lastKnown、handler）。 */
export function __resetSaveStateForTests(): void {
  for (const [, entry] of pending) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  pending.clear();
  lastKnown.clear();
  conflictHandler = null;
}
```

> 跨层说明：本任务后，前端 `flushPath` 已按 `WriteOutcome` 语义处理返回值，但 Rust `write_note` 仍返回 `()`、`read_note` 仍返回 `String`（见 Task 4/5）。因此**真实运行时**在 Task 4/5 落地前会抛错；本任务的测试用 mock 返回 `WriteOutcome`，故 `npm test` 与 `npm run build` 均通过。任务评审只需确认静态类型与 mock 测试通过，无需运行桌面应用。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- notes-state`
Expected: PASS（新增 7 项 + 既有 inboxPath/inboxEntry）。

- [ ] **Step 5: 类型检查**

Run: `npm run build`
Expected: tsc 通过（`readNote` 仍返回 `Promise<string>`，本任务未改其签名；`expectedMtime` 传 `null` 合法；`NoteContent`/`WriteOutcome` 已在本步定义）。

- [ ] **Step 6: 提交**

```bash
git add src/note/notes-state.ts src/note/notes-state.test.ts
git commit -m "fix(notes-state): per-path debounce, retry, flushAll

Replaces the single global save timer (which dropped the first file's
edits when switching files within 500ms) with a per-path pending map,
adds backoff retry on write failure and a flushAll hook for close/hide.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Rust `read_note`→`NoteContent`、`write_note`+`expected_mtime`→`WriteOutcome`

**Files:**
- Modify: `src-tauri/src/notes.rs`（新增 `NoteContent`/`WriteOutcome` 类型）
- Modify: `src-tauri/src/commands.rs:48-58`（`read_note`/`write_note`）

**Interfaces:**
- Consumes: `notes::write_atomic`、`notes::mtime_millis`（Task 1）
- Produces:
  - `notes::NoteContent { content: String, mtime: Option<u64> }`
  - `notes::WriteOutcome { conflict: bool, mtime: Option<u64> }`
  - `read_note(path) -> Result<NoteContent, String>`
  - `write_note(state, path, content, expected_mtime: Option<u64>) -> Result<WriteOutcome, String>`

- [ ] **Step 1: 在 `notes.rs` 加类型**

在 `src-tauri/src/notes.rs` 的 `NoteEntry` 结构体定义之后插入：

```rust
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteContent {
    pub content: String,
    pub mtime: Option<u64>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub conflict: bool,
    pub mtime: Option<u64>,
}
```

- [ ] **Step 2: 改 `read_note`**

`src-tauri/src/commands.rs:48-51`，将：

```rust
pub fn read_note(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|error| error.to_string())
}
```

改为：

```rust
pub fn read_note(path: String) -> Result<notes::NoteContent, String> {
    let content = std::fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mtime = notes::mtime_millis(std::path::Path::new(&path));
    Ok(notes::NoteContent { content, mtime })
}
```

- [ ] **Step 3: 改 `write_note`**

`src-tauri/src/commands.rs`（Task 2 改过的 `write_note`），将：

```rust
pub fn write_note(state: State<AppState>, path: String, content: String) -> Result<(), String> {
    crate::watcher::mark_self_write(&state.write_suppress, &path);
    notes::write_atomic(std::path::Path::new(&path), &content).map_err(|error| error.to_string())?;
    Ok(())
}
```

改为：

```rust
pub fn write_note(
    state: State<AppState>,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
) -> Result<notes::WriteOutcome, String> {
    let p = std::path::Path::new(&path);
    if let Some(expected) = expected_mtime {
        if notes::mtime_millis(p) != Some(expected) {
            return Ok(notes::WriteOutcome {
                conflict: true,
                mtime: None,
            });
        }
    }
    crate::watcher::mark_self_write(&state.write_suppress, &path);
    notes::write_atomic(p, &content).map_err(|error| error.to_string())?;
    let mtime = notes::mtime_millis(p);
    Ok(notes::WriteOutcome {
        conflict: false,
        mtime,
    })
}
```

- [ ] **Step 4: 编译 + 既有测试**

Run: `cd src-tauri && cargo check && cargo test --lib`
Expected: 编译通过；既有测试 PASS。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/notes.rs src-tauri/src/commands.rs
git commit -m "feat(notes): mtime guard on write_note, return NoteContent from read_note

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: 前端接入 mtime/冲突 + main.ts/tasks-panel 接线

**Files:**
- Modify: `src/note/notes-state.ts`（`readNote`→`NoteContent`、新增 `loadNote`、`scheduleSave`/`saveImmediate` 已传 `expectedMtime`、补 `loadNote` 测试）
- Modify: `src/note/main.ts`（8 处 `readNote`→`loadNote`、注册 `onConflict`、注册 `flushAll` 钩子）
- Modify: `src/note/tasks-panel.ts`（`persist`→`saveImmediate`、`reload`→`loadNote`、移除 `invoke` 导入）
- Test: `src/note/notes-state.test.ts`（追加 `loadNote`/`expectedMtime` 测试）

**Interfaces:**
- Consumes: `readNote`/`WriteOutcome`（Task 4）、`scheduleSave`/`saveImmediate`/`flushAll`/`onConflict`/`setLastKnown`/`discardPending`（Task 3）
- Produces: 闭环的自动保存/冲突/flush 链路。

- [ ] **Step 1: 写 `loadNote` 失败测试**

在 `src/note/notes-state.test.ts` 的 `save scheduling` describe 内追加：

```ts
  it("loadNote records mtime and scheduleSave passes it as expectedMtime", async () => {
    mockedInvoke.mockResolvedValueOnce({ content: "disk", mtime: 42 });
    const content = await loadNote("/a.md");
    expect(content).toBe("disk");
    mockedInvoke.mockResolvedValueOnce(okWrite(43));
    scheduleSave("/a.md", "edited");
    await vi.advanceTimersByTimeAsync(500);
    expect(mockedInvoke).toHaveBeenLastCalledWith("write_note", {
      path: "/a.md",
      content: "edited",
      expectedMtime: 42,
    });
  });

  it("saveImmediate force write passes expectedMtime null", async () => {
    mockedInvoke.mockResolvedValue(okWrite(50));
    setLastKnown("/a.md", 42);
    await saveImmediate("/a.md", "force", { force: true });
    expect(mockedInvoke).toHaveBeenCalledWith("write_note", {
      path: "/a.md",
      content: "force",
      expectedMtime: null,
    });
  });
```

并在顶部 import 列表加入 `loadNote`：

```ts
import {
  scheduleSave,
  saveImmediate,
  flushAll,
  isDirty,
  onConflict,
  setLastKnown,
  discardPending,
  loadNote,
  __resetSaveStateForTests,
} from "./notes-state";
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- notes-state`
Expected: FAIL（`loadNote` 未导出）。

- [ ] **Step 3: 在 `notes-state.ts` 实现 `loadNote` 并改 `readNote` 返回类型**

将 `src/note/notes-state.ts` 中：

```ts
export async function readNote(path: string): Promise<string> {
  return invoke<string>("read_note", { path });
}
```

改为：

```ts
export async function readNote(path: string): Promise<NoteContent> {
  return invoke<NoteContent>("read_note", { path });
}

/** 读取笔记并登记 lastKnown mtime，返回内容。UI 加载/重载笔记统一走这里。 */
export async function loadNote(path: string): Promise<string> {
  const { content, mtime } = await readNote(path);
  lastKnown.set(path, mtime);
  return content;
}
```

> `NoteContent`/`WriteOutcome` 类型已在 Task 3 Step 3 定义。`lastKnown` Map 已在 Task 3 定义。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- notes-state`
Expected: PASS（含新增 2 项）。

- [ ] **Step 5: `main.ts` 改 8 处 `readNote`→`loadNote` 并更新 import**

`src/note/main.ts` 的 import 块（`notes-state` 导入，约 33–42 行附近），把 `readNote,` 改为 `loadNote,`，并新增 `flushAll, onConflict, saveImmediate, discardPending,`：

```ts
  discardPending,
  flushAll,
  inboxEntry,
  isDirty,
  listPieces,
  listProjects,
  loadNote,
  onConflict,
  openDocumentFromFile,
  renameNote,
  renameProject,
  resolveDocuments,
  resolveProjects,
  saveImmediate,
  scheduleSave,
  setRecentDocuments,
  setRecentProjects,
  tasksPath,
  type CurrentNote,
  type NoteEntry,
  type ProjectEntry,
} from "./notes-state";
```

（移除 `readNote,` 行；其余保持字母序。）

然后把 `main.ts` 中全部 `await readNote(` 调用替换为 `await loadNote(`。涉及行（按 grep）：352、365、514、521、543、557、709。逐处替换，例如：

```ts
  // 352 行附近：
  setDoc(pieceEditor, await loadNote(entry.path));
  // 365 行附近：
  setDoc(pieceEditor, await loadNote(doc.path));
  // 514 行附近：
  applyRemoteDoc(await loadNote(current.entry.path));
  // 521 行附近：
  setDoc(pieceEditor, await loadNote(f.path));
  // 543 行附近：
  applyRemoteDoc(await loadNote(current.entry.path));
  // 557 行附近：
  setDoc(pieceEditor, await loadNote(activeFile.path));
  // 709 行附近：
  setDoc(editor, await loadNote(entry.path));
```

- [ ] **Step 6: `main.ts` 注册 `onConflict` 与 `flushAll` 钩子**

在 `src/note/main.ts` 的 `onFileChanged` 块之后（约 570 行后）插入：

```ts
// 保存冲突：磁盘被外部改动而本地有未保存编辑时，由 write_note 的 mtime 守卫触发。
onConflict(async (path, localContent) => {
  const keepMine = await confirmDialog(
    `文件已在外部被修改：\n${path}\n\n「确定」保留我的编辑并覆盖磁盘；「取消」用磁盘版本替换本地。`,
    "保存冲突",
  );
  if (keepMine) {
    await saveImmediate(path, localContent, { force: true });
    return;
  }
  discardPending(path);
  const content = await loadNote(path);
  if (current && path === current.entry.path) {
    applyRemoteDoc(content);
  } else {
    applyingRemote = true;
    setDoc(pieceEditor, content);
    applyingRemote = false;
  }
});

// 关闭/隐藏前尽量把 pending 写盘（窗口关闭被后端改为隐藏，webview 存活，invoke 可完成）。
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushAll();
});
window.addEventListener("pagehide", () => flushAll());
```

- [ ] **Step 7: `tasks-panel.ts` 接入 `saveImmediate`/`loadNote`，移除裸 `invoke`**

`src/note/tasks-panel.ts` 顶部 import 区，将：

```ts
import { invoke } from "@tauri-apps/api/core";
import { readNote } from "./notes-state";
```

改为：

```ts
import { loadNote, saveImmediate } from "./notes-state";
```

`persist`（54–58 行）改为：

```ts
  async function persist() {
    const path = host.tasksPath();
    if (!path) return;
    await saveImmediate(path, serializeTasks(items));
  }
```

`reload`（174–180 行）将 `items = parseTasks(await readNote(path));` 改为：

```ts
      items = parseTasks(await loadNote(path));
```

- [ ] **Step 8: 类型检查 + 全量测试**

Run: `npm run build && npm test`
Expected: tsc 通过；全部 Vitest 测试 PASS。

- [ ] **Step 9: 提交**

```bash
git add src/note/notes-state.ts src/note/notes-state.test.ts src/note/main.ts src/note/tasks-panel.ts
git commit -m "feat(note): wire mtime conflict guard, loadNote, flush hooks

Closes the autosave loop: read_note returns mtime, loadNote records it,
scheduleSave passes expectedMtime, write_note reports conflict, the
onConflict handler prompts the user, and flushAll drains pending writes
on hide/pagehide. tasks-panel now routes through saveImmediate.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: 端到端验证

**Files:** 无修改。

- [ ] **Step 1: Rust 检查 + 测试**

Run: `cd src-tauri && cargo check && cargo test --lib`
Expected: 编译通过；全部 Rust 测试 PASS。

- [ ] **Step 2: 前端检查 + 测试**

Run: `npm run build && npm test`
Expected: tsc 通过；全部 Vitest 测试 PASS。

- [ ] **Step 3: 手动冒烟（可选，需桌面环境）**

Run: `npm run tauri dev`
验证清单：
1. 在 inbox 打字 → 500ms 后磁盘 `_inbox.md` 更新（原子写，无 `.tmp` 残留）。
2. 快速在 inbox 与 piece 间交替打字 → 两文件最终都落盘（回归 bug 未复现）。
3. 用外部编辑器改 `_inbox.md` 并保存 → 约 0.5s 内窗口刷新为磁盘内容。
4. 在窗口打字后（未到 500ms）外部编辑器保存同一文件 → 下次写时弹冲突对话框；选「确定」本地覆盖磁盘，选「取消」磁盘替换本地。
5. 切到另一应用（窗口隐藏）→ pending 编辑立即写盘。
6. tasks 面板勾选/增删 → `_tasks.md` 立即更新。

- [ ] **Step 4: 提交验证记录（可选）**

无需提交（本任务无代码改动）。若发现回归，回到对应 Task 修复后再提交。

---

## Self-Review 记录

- **Spec 覆盖：** A（原子写）→ Task 1+2；B（mtime 守卫）→ Task 4+5；C（per-path 防抖）→ Task 3；D（冲突回调）→ Task 5；E（关闭前 flush）→ Task 5；F（tasks 接入）→ Task 5；G（冗余清理：单全局 timer、dirtyPaths、四处 std::fs::write、tasks 裸 invoke）→ Task 2/3/5；H（测试）→ Task 1/3/5。全覆盖。
- **占位扫描：** 无占位/TODO；Task 3 Step 3 一次性写入正确的 `flushAll`/`flushPath`/类型/重置，无重复逻辑块。
- **类型一致：** `NoteContent`/`WriteOutcome` 在 Rust（Task 4）与 TS（Task 3 Step 4）字段名一致（`content`/`mtime`/`conflict`，camelCase）；`expectedMtime`(JS)↔`expected_mtime`(Rust) 遵循 Tauri 约定；`scheduleSave`/`saveImmediate`/`flushAll`/`onConflict`/`setLastKnown`/`discardPending`/`loadNote`/`isDirty` 在 Task 3/5 定义与调用方一致。
