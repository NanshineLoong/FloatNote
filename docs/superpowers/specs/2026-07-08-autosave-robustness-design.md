# 自动保存健壮性完善 — 设计稿

- 日期：2026-07-08
- 分支：`worktree-autosave-robustness`
- 目标：按业界最佳实践完善 FloatNote 笔记窗口的自动保存与外部变更同步，修复已知的丢数据风险，并移除被取代的冗余代码。

## 莫越界（YAGNI）

本设计面向**单人本地记事**场景，明确不做：

- 三方合并 / diff 合并器。
- 多端协作、CRDT、操作历史同步。
- 可见的保存状态条（用户选择仅后台重试，无 UI）。

## 背景：当前实现与问题

经调研确认的现存缺陷（详见调研结论）：

1. **写入非原子、无 fsync**：`write_note` 等处用 `std::fs::write` 截断-重写（`commands.rs:54-58` 等 4 处）。崩溃/断电/磁盘满时文件可能停留在部分写入或空文件状态。
2. **`scheduleSave` 单全局 timer + 闭包捕获末次参数**（`notes-state.ts:174-186`）：快速切换文件编辑时，先编辑的文件内容从未落盘，且其路径永久残留在 `dirtyPaths` 中，导致该路径的外部变更重载被永久跳过。
3. **无冲突检测**：dirty 时静默丢弃外部编辑；写入与外部编辑竞态时 last-write-wins 覆盖，无提示。
4. **写失败无重试、无反馈**：`scheduleSave` 的 `.catch` 仅 `console.error` 并清掉 dirty 标记；`tasks-panel.ts:70-74` 的 `persist()` 连 `.catch` 都没有。
5. **强退/崩溃丢 500ms 窗口内编辑**：窗口关闭被 `prevent_close` 改为隐藏（`lib.rs:73-78`、`windows.rs:49-54`），正常关闭时 pending timer 能存活，但进程被杀时丢失。
6. **写入逻辑四处重复**：`commands.rs` 的 `write_note`/`create_note`/`restore_version` 与 `agent.rs::apply_write` 各自 `std::fs::write`。

## 设计

### A. Rust：原子写入集中化

在 `src-tauri/src/notes.rs` 新增：

```rust
use std::io::Write;

/// 原子写入：写到同目录临时文件（非 .md 后缀，watcher 忽略）→ fsync → rename 原子替换。
pub fn write_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or(Path::new("."));
    let tmp = tmp_path_in(dir, path);
    {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(())
}
```

- `tmp_path_in`：`<dir>/<stem>.<n>.tmp`，`<n>` 取自进程级 `AtomicU64` 计数器，保证并发唯一；后缀 `.tmp`（非 `.md`），watcher 在 `handle_file_event` 的 `.md` 过滤（`watcher.rs:126`）处直接忽略临时文件。
- `rename` 在 POSIX 与 Windows 同盘均原子且覆盖目标。
- 调用方在 rename **之前** 调 `watcher::mark_self_write(final_path)`，覆盖 rename 产生的 `.md` Create/Modify 事件。

替换 4 处 `std::fs::write`：

- `commands.rs:56` `write_note`
- `commands.rs:79` `create_note`
- `commands.rs:128` `restore_version`
- `agent.rs:380` `apply_write`（同时保留其 `versions::snapshot` 语义）

`delete_note` 用 `trash::delete`，不动。

### B. Rust：write_note mtime 守卫 + read_note 返回 mtime

`read_note` 返回结构而非裸字符串：

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteContent {
    pub content: String,
    pub mtime: Option<u64>, // UNIX_EPOCH 毫秒；文件不存在或不可读时为 None
}
```

`read_note(path) -> Result<NoteContent, String>`：读内容 + 取 `modified()` 毫秒。

`write_note` 增 `expected_mtime: Option<u64>`，返回 `WriteOutcome`（结构体，前端判别更简洁）：

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub conflict: bool,
    pub mtime: Option<u64>, // 写入成功后的新 mtime；conflict 时为 None
}
```

逻辑：

1. 若 `expected_mtime` 为 `Some(e)`：取磁盘 `modified()` 毫秒 `d`；若 `d != Some(e)` → 返回 `WriteOutcome { conflict: true, mtime: None }`，**不写**。
2. 否则（`None` = 强制写，用于用户选择"保留我的"后）：跳过守卫。
3. `mark_self_write(final)` → `write_atomic` → 取新 mtime → `WriteOutcome { conflict: false, mtime }`。

`expected_mtime = None` 也覆盖"新文件/不在乎冲突"的旧调用方语义。

### C. 前端：per-path 防抖与 pending 状态（修跨文件丢数据 bug）

`src/note/notes-state.ts` 重写保存调度，替换单全局 `saveTimer` + `dirtyPaths` Set：

```ts
interface PendingWrite {
  content: string;
  timer: ReturnType<typeof setTimeout> | null;
  retry: number;
  expectedMtime: number | null; // 来自 lastKnown；强制写时为 null
}
const pending = new Map<string, PendingWrite>();
const lastKnown = new Map<string, number>(); // path → mtime(ms)
```

- `scheduleSave(path, content)`：更新/插入 pending 项，`expectedMtime = lastKnown.get(path) ?? null`，重置 500ms 尾沿 timer（每路径独立）。timer fire → 调 `flushPath(path)`。
- `flushPath(path)`：`invoke("write_note", { path, content, expectedMtime })`：
  - `Ok { mtime }` → `lastKnown.set(path, mtime)`；`pending.delete(path)`。
  - `Conflict` → 调 `conflictHandler?.(path, content)`（由 `main.ts` 注册）。
  - IO 错误 → `retry++`；`retry < 3` 时按 500ms/1s/2s 退避重排 timer；否则 `console.error` 并**保留 pending**（下次编辑自然续写）。
- `saveImmediate(path, content, opts?)`：tasks 面板与冲突"保留我的"用。等同 `flushPath` 但不经过 timer（仍走相同重试/冲突/lastKnown 逻辑）。`opts.force` 为 `true` 时 `expectedMtime=null`（强制覆盖，跳过守卫）。默认 `expectedMtime = lastKnown.get(path) ?? null`。
- `flushAll()`：遍历 pending，清 timer，对每项 `flushPath`（fire-and-forget；用于关闭/隐藏前）。
- `isDirty(path)`：`pending.has(path)`（保留导出，供 `onFileChanged` 用）。
- `setLastKnown(path, mtime)`：外部变更重载、AI `apply_write` 重载后由 `main.ts` 调用，更新 lastKnown。
- `onConflict(handler)`：注册冲突回调。

### D. 前端：冲突回调（无状态条，仅原生对话框）

`main.ts` 注册：

```ts
onConflict(async (path, localContent) => {
  const keepMine = await confirmDialog(`文件已在外部被修改：\n${path}\n\n保留我的编辑并覆盖？`, "保存冲突");
  if (keepMine) {
    await saveImmediate(path, localContent, { force: true }); // expectedMtime=null 强制写
  } else {
    const { content, mtime } = await readNote(path);
    setLastKnown(path, mtime ?? null);
    // 注入对应编辑器：inbox→applyRemoteDoc；piece/doc→setDoc(applyingRemote)
  }
});
```

`onFileChanged`（`main.ts:528-570`）保持"dirty 时跳过重载"逻辑不变——冲突改由写时 mtime 守卫浮现，两条路径一致。重载成功后调 `setLastKnown`。

### E. 前端：关闭前 flush

在笔记窗入口（`src/note/main.ts`）注册：

- `document.addEventListener("visibilitychange", …)`：`hidden` 时 `flushAll()`。
- `window.addEventListener("pagehide", …)`：`flushAll()`。
- Tauri `window.onCloseRequested`（或 `tauri://close-requested`）：`flushAll()` 后再放行 hide。

`flushAll` 为 fire-and-forget；窗口 hide 后 webview 存活，pending 的 `invoke` 能完成。进程被强杀仍可能丢最后 <500ms，但属不可完全规避边界，可接受。

### F. 前端：tasks 面板接入

`src/note/tasks-panel.ts:70-74` 的 `persist()` 改调 `saveImmediate(path, serializeTasks(items))`，删除裸 `invoke` 与无 `.catch`。勾选/增删/重命名/拖动每次仍立即写（低频，无需防抖），但获得原子写 + 重试 + 冲突处理。

### G. 移除的冗余代码

- `notes-state.ts`：`saveTimer` 单全局变量、闭包捕获末次参数的 `setTimeout` 写法、`dirtyPaths` Set。
- `commands.rs` / `agent.rs`：4 处 `std::fs::write` 重复，收敛到 `notes::write_atomic`。
- `tasks-panel.ts`：裸 `invoke("write_note")` 无错误处理。

### H. 测试

- 新增 `src/note/notes-state.test.ts`（Vitest）：`vi.mock("@tauri-apps/api/core")` mock `invoke`，`vi.useFakeTimers()`。覆盖：
  1. **跨文件独立计时**（回归 bug）：A 编辑后 100ms 编辑 B，时钟推进，A 应先于 B 的窗口被写入且内容正确。
  2. 连续编辑合并：同路径连续 3 次编辑，只写最后一次。
  3. `Conflict` → 调 `onConflict` 回调，且 pending 未被删除。
  4. IO 错误退避重试 3 次后保留 pending。
  5. `saveImmediate` 立即写。
- `src-tauri/src/notes.rs` 加 `#[test]`：`write_atomic` 写入内容正确、目标文件被替换、临时文件无残留、对不存在的父目录返回错误。`cargo check`（并 `cargo test --lib notes`）。

## 受影响文件

- `src-tauri/src/notes.rs`（新增 `write_atomic` + `NoteContent`/`WriteOutcome` + 测试）
- `src-tauri/src/commands.rs`（`read_note`/`write_note`/`create_note`/`restore_version` 改用新签名与 `write_atomic`）
- `src-tauri/src/agent.rs`（`apply_write` 用 `write_atomic`）
- `src/note/notes-state.ts`（重写保存调度）
- `src/note/main.ts`（`readNote` 适配新返回、注册 `onConflict`、`flushAll` 钩子、`setLastKnown` 调用）
- `src/note/tasks-panel.ts`（`persist` 走 `saveImmediate`）
- `src/note/notes-state.test.ts`（新增）

## 平台考量

- 原子 `rename`：POSIX `rename(2)` 与 Windows `MoveFileEx(REPLACE_EXISTING)` 在同盘均原子。
- `.tmp` 后缀使 watcher 在两端都忽略临时文件（macOS FSEvent、Windows RDCW）。
- mtime 用 `SystemTime::duration_since(UNIX_EPOCH)` 的毫秒，跨平台一致；FAT/exFAT 精度有限但仅用于"是否变化"比对，足够。

## 风险与回退

- `read_note` 返回类型变更属破坏性 API 改动：所有 `readNote` 调用方需改取 `.content`。影响面在 `main.ts`/`agent.ts` 内可控。
- 回退：本分支独立，不合则不影响 `main`。
