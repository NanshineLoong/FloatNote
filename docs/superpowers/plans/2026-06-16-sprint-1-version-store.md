# Sprint 1 — 版本快照库 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给每篇笔记加一个自建的全文快照版本库，用户可手动打快照、查看版本列表、回退到任意版本——为后续"AI 覆盖自动留版本"打好底座。

**Architecture:** 新增 Rust 模块 `versions.rs`，把版本存到 `<notes_dir>/.floatnote/versions/<note_id>/`（`vN.md` + `manifest.json`，`note_id` = 笔记文件名 stem）。通过 Tauri 命令暴露 snapshot/list/restore。前端在编辑器底部加"版本条"。重命名笔记时连带迁移版本目录。

**Tech Stack:** Rust（serde / serde_json / chrono，均已是现有依赖）、TypeScript + Vite、Vitest。

---

## 文件结构

- Create: `src-tauri/src/versions.rs` — 版本库核心（纯函数 + std::fs，自带单测）
- Modify: `src-tauri/src/lib.rs` — 注册 `mod versions;` 和新命令
- Modify: `src-tauri/src/commands.rs` — 新增 snapshot/list/restore 命令；扩展 rename 迁移版本目录
- Modify: `src-tauri/src/notes.rs` — `rename_note` 之外，无需改；迁移在 commands 层调用 `versions::rename`
- Create: `src/note/versions.ts` — 前端 invoke 封装 + 纯展示helper
- Create: `src/note/versions.test.ts` — helper 单测
- Create: `src/note/version-bar.ts` — 底部版本条 UI
- Modify: `src/note/main.ts` — 挂载版本条、接线打快照/回退
- Modify: `src/styles.css` — 版本条样式

---

## Task 1: `versions.rs` — 数据结构与路径

**Files:**
- Create: `src-tauri/src/versions.rs`
- Modify: `src-tauri/src/lib.rs:1-8`（模块声明）

- [ ] **Step 1: 注册模块**

在 `src-tauri/src/lib.rs` 顶部模块列表加入（保持字母序附近即可）：

```rust
mod versions;
```

- [ ] **Step 2: 写结构体与路径辅助函数（先建文件）**

`src-tauri/src/versions.rs`：

```rust
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct VersionEntry {
    pub v: u32,
    pub ts: String,       // RFC3339 时间戳
    pub source: String,   // "ai" | "manual"
    pub summary: Option<String>,
}

fn versions_dir(notes_dir: &Path, note_id: &str) -> PathBuf {
    notes_dir.join(".floatnote").join("versions").join(note_id)
}

fn manifest_path(notes_dir: &Path, note_id: &str) -> PathBuf {
    versions_dir(notes_dir, note_id).join("manifest.json")
}
```

- [ ] **Step 3: 编译确认无误**

Run: `cd src-tauri && cargo check`
Expected: 通过（可能有 unused 警告，下一任务消除）。

---

## Task 2: `versions.rs` — list / snapshot

**Files:**
- Modify: `src-tauri/src/versions.rs`

- [ ] **Step 1: 写失败测试**

在 `versions.rs` 末尾加测试模块（复用 notes.rs 同款 TempDir helper）：

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_snapshot_is_v1_and_listed() {
        let dir = tempdir();
        let v = snapshot(dir.path(), "note", "hello", "manual").unwrap();
        assert_eq!(v, 1);
        let entries = list(dir.path(), "note");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].v, 1);
        assert_eq!(entries[0].source, "manual");
    }

    #[test]
    fn snapshots_increment_and_store_content() {
        let dir = tempdir();
        snapshot(dir.path(), "note", "one", "manual").unwrap();
        let v2 = snapshot(dir.path(), "note", "two", "ai").unwrap();
        assert_eq!(v2, 2);
        assert_eq!(read_version(dir.path(), "note", 1).unwrap(), "one");
        assert_eq!(read_version(dir.path(), "note", 2).unwrap(), "two");
        assert_eq!(list(dir.path(), "note").len(), 2);
    }

    #[test]
    fn list_empty_when_no_history() {
        let dir = tempdir();
        assert!(list(dir.path(), "missing").is_empty());
    }

    fn tempdir() -> TempDir {
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let mut path = std::env::temp_dir();
        path.push(format!(
            "floatnote-ver-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        TempDir(path)
    }

    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn path(&self) -> &std::path::Path { &self.0 }
    }
    impl Drop for TempDir {
        fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test versions::`
Expected: 编译失败 —— `list` / `snapshot` / `read_version` 未定义。

- [ ] **Step 3: 实现 list / snapshot / read_version**

在 `versions.rs`（测试模块之前）添加：

```rust
pub fn list(notes_dir: &Path, note_id: &str) -> Vec<VersionEntry> {
    match std::fs::read_to_string(manifest_path(notes_dir, note_id)) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn snapshot(
    notes_dir: &Path,
    note_id: &str,
    content: &str,
    source: &str,
) -> std::io::Result<u32> {
    let dir = versions_dir(notes_dir, note_id);
    std::fs::create_dir_all(&dir)?;
    let mut entries = list(notes_dir, note_id);
    let next = entries.last().map(|entry| entry.v + 1).unwrap_or(1);
    std::fs::write(dir.join(format!("v{next}.md")), content)?;
    entries.push(VersionEntry {
        v: next,
        ts: Utc::now().to_rfc3339(),
        source: source.to_string(),
        summary: None,
    });
    std::fs::write(
        manifest_path(notes_dir, note_id),
        serde_json::to_string_pretty(&entries).unwrap(),
    )?;
    Ok(next)
}

pub fn read_version(notes_dir: &Path, note_id: &str, v: u32) -> std::io::Result<String> {
    std::fs::read_to_string(versions_dir(notes_dir, note_id).join(format!("v{v}.md")))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && cargo test versions::`
Expected: 3 passed。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/versions.rs src-tauri/src/lib.rs
git commit -m "feat(versions): snapshot/list/read core"
```

---

## Task 3: `versions.rs` — 重命名时迁移版本目录

**Files:**
- Modify: `src-tauri/src/versions.rs`

- [ ] **Step 1: 写失败测试**

在 `mod tests` 内追加：

```rust
#[test]
fn rename_moves_history() {
    let dir = tempdir();
    snapshot(dir.path(), "old", "x", "manual").unwrap();
    rename(dir.path(), "old", "new").unwrap();
    assert!(list(dir.path(), "old").is_empty());
    assert_eq!(list(dir.path(), "new").len(), 1);
    assert_eq!(read_version(dir.path(), "new", 1).unwrap(), "x");
}

#[test]
fn rename_noop_when_no_history() {
    let dir = tempdir();
    assert!(rename(dir.path(), "old", "new").is_ok());
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd src-tauri && cargo test versions::`
Expected: 失败 —— `rename` 未定义。

- [ ] **Step 3: 实现 rename**

```rust
pub fn rename(notes_dir: &Path, old_id: &str, new_id: &str) -> std::io::Result<()> {
    let old = versions_dir(notes_dir, old_id);
    if old.exists() {
        let new = versions_dir(notes_dir, new_id);
        if let Some(parent) = new.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(old, new)?;
    }
    Ok(())
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd src-tauri && cargo test versions::`
Expected: 5 passed。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/versions.rs
git commit -m "feat(versions): preserve history across rename"
```

---

## Task 4: Tauri 命令

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs:59-69`（invoke_handler）

- [ ] **Step 1: 加命令**

`src-tauri/src/commands.rs` 顶部 `use` 加 `versions`：

```rust
use crate::{config::Config, notes, versions};
```

文件末尾追加（`config_path` 之前）：

```rust
#[tauri::command]
pub fn list_versions(dir: String, note_id: String) -> Vec<versions::VersionEntry> {
    versions::list(std::path::Path::new(&dir), &note_id)
}

#[tauri::command]
pub fn snapshot_note(
    dir: String,
    note_id: String,
    content: String,
    source: String,
) -> Result<u32, String> {
    versions::snapshot(std::path::Path::new(&dir), &note_id, &content, &source)
        .map_err(|error| error.to_string())
}

/// 回退：先把"当前内容"留为安全版本，再把第 v 版写回笔记文件，并返回其内容。
#[tauri::command]
pub fn restore_version(
    dir: String,
    note_id: String,
    path: String,
    current_content: String,
    v: u32,
) -> Result<String, String> {
    let dir_path = std::path::Path::new(&dir);
    versions::snapshot(dir_path, &note_id, &current_content, "manual")
        .map_err(|error| error.to_string())?;
    let restored = versions::read_version(dir_path, &note_id, v).map_err(|error| error.to_string())?;
    std::fs::write(&path, &restored).map_err(|error| error.to_string())?;
    Ok(restored)
}
```

- [ ] **Step 2: 扩展 rename_note 迁移版本**

把 `commands.rs` 现有 `rename_note` 改为在成功改名后迁移版本目录：

```rust
#[tauri::command]
pub fn rename_note(dir: String, old_name: String, new_stem: String) -> Result<String, String> {
    let dir_path = std::path::Path::new(&dir);
    let new_path = notes::rename_note(dir_path, &old_name, &new_stem)
        .map_err(|error| error.to_string())?;
    versions::rename(dir_path, &old_name, &new_stem).map_err(|error| error.to_string())?;
    Ok(new_path)
}
```

- [ ] **Step 3: 注册命令**

`src-tauri/src/lib.rs` 的 `generate_handler!` 列表追加：

```rust
            commands::list_versions,
            commands::snapshot_note,
            commands::restore_version,
```

- [ ] **Step 4: 编译 + 跑全部 Rust 测试**

Run: `cd src-tauri && cargo test`
Expected: 全部通过（含 notes/config/versions）。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(versions): expose snapshot/list/restore commands + rename migration"
```

---

## Task 5: 前端封装与展示 helper（TDD）

**Files:**
- Create: `src/note/versions.ts`
- Create: `src/note/versions.test.ts`

- [ ] **Step 1: 写失败测试**

`src/note/versions.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { formatVersionLabel, type VersionEntry } from "./versions";

describe("formatVersionLabel", () => {
  it("formats version number and short time", () => {
    const entry: VersionEntry = { v: 3, ts: "2026-06-16T10:42:00+08:00", source: "ai", summary: null };
    expect(formatVersionLabel(entry)).toBe("v3 · AI · 10:42");
  });

  it("labels manual snapshots", () => {
    const entry: VersionEntry = { v: 1, ts: "2026-06-16T09:05:00+08:00", source: "manual", summary: null };
    expect(formatVersionLabel(entry)).toBe("v1 · 手动 · 09:05");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test -- versions`
Expected: 失败 —— 模块不存在。

- [ ] **Step 3: 实现封装 + helper**

`src/note/versions.ts`：

```ts
import { invoke } from "@tauri-apps/api/core";

export interface VersionEntry {
  v: number;
  ts: string;
  source: "ai" | "manual";
  summary: string | null;
}

export function listVersions(dir: string, noteId: string): Promise<VersionEntry[]> {
  return invoke<VersionEntry[]>("list_versions", { dir, noteId });
}

export function snapshotNote(
  dir: string,
  noteId: string,
  content: string,
  source: "ai" | "manual",
): Promise<number> {
  return invoke<number>("snapshot_note", { dir, noteId, content, source });
}

export function restoreVersion(
  dir: string,
  noteId: string,
  path: string,
  currentContent: string,
  v: number,
): Promise<string> {
  return invoke<string>("restore_version", { dir, noteId, path, currentContent, v });
}

export function formatVersionLabel(entry: VersionEntry): string {
  const time = entry.ts.slice(11, 16); // "HH:MM" from RFC3339
  const who = entry.source === "ai" ? "AI" : "手动";
  return `v${entry.v} · ${who} · ${time}`;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test -- versions`
Expected: 2 passed。

- [ ] **Step 5: 提交**

```bash
git add src/note/versions.ts src/note/versions.test.ts
git commit -m "feat(versions): frontend bindings + label helper"
```

---

## Task 6: 底部版本条 UI + 接线

**Files:**
- Create: `src/note/version-bar.ts`
- Modify: `src/note/main.ts`
- Modify: `src/styles.css`

- [ ] **Step 1: 版本条组件**

`src/note/version-bar.ts`：

```ts
import { formatVersionLabel, type VersionEntry } from "./versions";

export interface VersionBarCallbacks {
  onSnapshot: () => void;
  onRestore: (v: number) => void;
  loadVersions: () => Promise<VersionEntry[]>;
}

export function renderVersionBar(root: HTMLElement, callbacks: VersionBarCallbacks) {
  root.innerHTML = `
    <div class="version-bar">
      <button class="version-btn" id="version-btn"><i class="ph ph-clock-counter-clockwise"></i><span>版本</span></button>
      <button class="version-snap" id="version-snap" title="打快照"><i class="ph ph-camera"></i></button>
    </div>
  `;

  let menu: HTMLElement | null = null;
  const closeMenu = () => { menu?.remove(); menu = null; };

  const btn = root.querySelector<HTMLElement>("#version-btn")!;
  btn.onclick = async () => {
    if (menu) { closeMenu(); return; }
    const entries = await callbacks.loadVersions();
    menu = document.createElement("div");
    menu.className = "version-menu";
    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "version-empty";
      empty.textContent = "暂无版本";
      menu.appendChild(empty);
    }
    for (const entry of [...entries].reverse()) {
      const item = document.createElement("button");
      item.className = "version-item";
      item.textContent = formatVersionLabel(entry);
      item.onclick = () => { closeMenu(); callbacks.onRestore(entry.v); };
      menu.appendChild(item);
    }
    const rect = btn.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  };

  root.querySelector<HTMLElement>("#version-snap")!.onclick = callbacks.onSnapshot;
}
```

- [ ] **Step 2: 在 main.ts 挂载并接线**

`src/note/main.ts`：第 23 行的 `app.innerHTML` 改为附加版本条容器：

```ts
app.innerHTML = `<div id="topbar-root"></div><div id="editor-root"></div><div id="version-root"></div>`;
```

顶部 import 追加：

```ts
import { renderVersionBar } from "./version-bar";
import { listVersions, restoreVersion, snapshotNote } from "./versions";
import { setDoc as setEditorDoc } from "./editor"; // 若已 import setDoc 则复用，勿重复
```

（注意：`setDoc` 已在第 6 行 import，直接复用 `setDoc`，不要新增别名 import。）

在 `renderTopbar(...)` 调用之后追加：

```ts
renderVersionBar(document.querySelector("#version-root")!, {
  loadVersions: () => (current ? listVersions(current.dir, current.entry.name) : Promise.resolve([])),
  onSnapshot: async () => {
    if (!current) return;
    await snapshotNote(current.dir, current.entry.name, editor.state.doc.toString(), "manual");
  },
  onRestore: async (v) => {
    if (!current) return;
    const restored = await restoreVersion(
      current.dir,
      current.entry.name,
      current.entry.path,
      editor.state.doc.toString(),
      v,
    );
    setDoc(editor, restored);
  },
});
```

- [ ] **Step 3: 样式**

`src/styles.css` 末尾追加（颜色沿用现有变量风格，若无对应变量则用下列字面值）：

```css
.version-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  font-size: 12px;
}
.version-btn, .version-snap {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: none;
  color: rgba(0, 0, 0, 0.55);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.version-btn:hover, .version-snap:hover { background: rgba(0, 0, 0, 0.06); }
.version-menu {
  position: fixed;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  padding: 4px;
  min-width: 160px;
  max-height: 280px;
  overflow-y: auto;
  z-index: 50;
}
.version-item, .version-empty {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.75);
  cursor: pointer;
}
.version-item:hover { background: rgba(0, 0, 0, 0.06); }
.version-empty { color: rgba(0, 0, 0, 0.4); cursor: default; }
```

- [ ] **Step 4: 类型检查 + 单测**

Run: `npm run build && npm test`
Expected: tsc 通过，vitest 全绿。

- [ ] **Step 5: 手动验证**

Run: `npm run tauri dev`
做：编辑笔记 → 点相机"打快照" → 改内容 → 点"版本"看到列表 → 点旧版本 → 编辑器恢复为旧内容、且"版本"列表新增一条安全版本。

- [ ] **Step 6: 提交**

```bash
git add src/note/version-bar.ts src/note/main.ts src/styles.css
git commit -m "feat(versions): bottom version bar with snapshot + restore"
```

---

## 验收清单（Sprint 1 Done）

- [ ] `cd src-tauri && cargo test` 全绿（versions 5 个新测试在内）
- [ ] `npm test` 全绿（versions helper 测试在内）
- [ ] `npm run build` 通过
- [ ] 手动：打快照 / 列表 / 回退 三个动作在 `npm run tauri dev` 下可用
- [ ] 重命名笔记后版本历史仍在
- [ ] `.floatnote/` 已在 `.gitignore`（如未，则本 sprint 追加一行 `.floatnote/`）

## 给后续 sprint 的接口约定

- `note_id` 统一使用**笔记文件名 stem**（即前端 `NoteEntry.name`）。
- `versions::snapshot(dir, note_id, content, "ai")` 即 Sprint 3 中 AI 覆盖笔记时的留版本入口。
- 回退命令 `restore_version` 已含"先留安全版本"语义，AI 覆盖路径无需重复。
