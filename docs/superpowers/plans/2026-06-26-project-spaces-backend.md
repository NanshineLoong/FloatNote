# Project Spaces — Backend Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Rust data layer that turns a working directory into a set of "project spaces" — folders each containing `_inbox.md`, `_tasks.md`, and one or more 成品 notes — with pure, cargo-tested functions plus the Tauri commands that expose them.

**Architecture:** A new `src-tauri/src/project.rs` module holds pure filesystem helpers (classify a folder as a project, list project folders, scaffold a new project, list a project's 成品 notes). These mirror the existing `notes.rs` style (plain functions + a `#[cfg(test)]` tempdir harness). Thin `#[tauri::command]` wrappers in `commands.rs` expose them, registered in `lib.rs`. No frontend changes in this plan — it is the foundation the later plans build on.

**Tech Stack:** Rust, Tauri 2, `serde` (serializable command payloads), `std::fs`. Tests use cargo's built-in test harness, run with `--manifest-path src-tauri/Cargo.toml` from the repo root.

This is **Plan 1 of 7** for the FloatNote project-spaces feature (see `docs/superpowers/specs/2026-06-26-project-spaces-design.md`). It ships a fully-tested backend; user-visible behavior arrives in Plan 2 (navigation).

---

## File Structure

- **Create:** `src-tauri/src/project.rs` — project-space filesystem helpers + unit tests. One responsibility: classifying and scaffolding project folders. Kept separate from `notes.rs` (which stays the flat-`.md` helper) so each file holds one model.
- **Modify:** `src-tauri/src/lib.rs` — declare `mod project;` and register three new commands.
- **Modify:** `src-tauri/src/commands.rs` — add three thin command wrappers.

Naming conventions (locked by the spec):
- `_inbox.md` and `_tasks.md` are the system files (leading underscore).
- Any `.md` in a project folder **without** a leading underscore is a 成品 note; the default is `piece.md`.
- A folder counts as a project space iff it contains `_inbox.md`.

---

### Task 1: Project module skeleton + `is_project_dir`

**Files:**
- Create: `src-tauri/src/project.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod project;`)

- [ ] **Step 1: Declare the module so it compiles**

In `src-tauri/src/lib.rs`, add `mod project;` to the module list at the top (alphabetical, after `mod notes;`):

```rust
mod agent;
mod capture;
mod commands;
mod config;
mod notes;
mod project;
mod quote;
mod shortcuts;
mod tray;
mod versions;
mod windows;
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/project.rs` with the constants, the `ProjectEntry` type, `is_project_dir`, and a test module that includes a tempdir harness (same pattern as `notes.rs`):

```rust
use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::notes::NoteEntry;

pub const INBOX_FILE: &str = "_inbox.md";
pub const TASKS_FILE: &str = "_tasks.md";
pub const DEFAULT_PIECE: &str = "piece.md";

#[derive(Serialize, Debug, PartialEq)]
pub struct ProjectEntry {
    /// Folder name (display label).
    pub name: String,
    /// Absolute folder path.
    pub path: String,
}

/// A directory counts as a project space when it holds an `_inbox.md`.
pub fn is_project_dir(dir: &Path) -> bool {
    dir.join(INBOX_FILE).is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_project_by_inbox_file() {
        let dir = tempdir();
        assert!(!is_project_dir(dir.path()));
        std::fs::write(dir.path().join(INBOX_FILE), "").unwrap();
        assert!(is_project_dir(dir.path()));
    }

    fn tempdir() -> TempDir {
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let mut path = std::env::temp_dir();
        path.push(format!(
            "floatnote-project-test-{}-{}-{}",
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
        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
```

Note: `NoteEntry`, `PathBuf`, `Serialize`, and the constants are imported now because later tasks in this file use them; that avoids unused-import churn between tasks. If the compiler warns about an unused import at this step, leave it — Task 4 and Task 5 consume them.

- [ ] **Step 3: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml project::tests::detects_project_by_inbox_file`
Expected: PASS (1 passed). This test has no pre-existing implementation gap — it verifies the freshly written `is_project_dir`; it fails only if the logic is wrong.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/project.rs src-tauri/src/lib.rs
git commit -m "feat(project): add project module and is_project_dir"
```

---

### Task 2: `list_projects`

**Files:**
- Modify: `src-tauri/src/project.rs`

- [ ] **Step 1: Write the failing test**

Add this test inside the `tests` module in `src-tauri/src/project.rs` (above the `tempdir` helper):

```rust
    #[test]
    fn lists_only_project_folders_newest_first() {
        let root = tempdir();
        // A project folder.
        let a = root.path().join("alpha");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::write(a.join(INBOX_FILE), "").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        // A newer project folder.
        let b = root.path().join("beta");
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(b.join(INBOX_FILE), "").unwrap();
        // A plain folder without _inbox.md (ignored).
        std::fs::create_dir_all(root.path().join("plain")).unwrap();
        // A loose markdown file at the root (ignored — not a directory).
        std::fs::write(root.path().join("legacy.md"), "x").unwrap();

        let names: Vec<String> = list_projects(root.path())
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(names, vec!["beta".to_string(), "alpha".to_string()]);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml project::tests::lists_only_project_folders_newest_first`
Expected: FAIL to compile with "cannot find function `list_projects` in this scope".

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/project.rs` (after `is_project_dir`):

```rust
/// List the project-space subfolders of `root` (those containing `_inbox.md`),
/// newest-modified first. Loose files and non-project folders are skipped.
pub fn list_projects(root: &Path) -> std::io::Result<Vec<ProjectEntry>> {
    let mut entries: Vec<(std::time::SystemTime, ProjectEntry)> = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() || !is_project_dir(&path) {
            continue;
        }
        let modified = entry.metadata()?.modified()?;
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        entries.push((
            modified,
            ProjectEntry {
                name,
                path: path.to_string_lossy().to_string(),
            },
        ));
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(entries.into_iter().map(|(_, entry)| entry).collect())
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml project::tests::lists_only_project_folders_newest_first`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/project.rs
git commit -m "feat(project): list project-space folders newest-first"
```

---

### Task 3: `sanitize_folder_name`

**Files:**
- Modify: `src-tauri/src/project.rs`

- [ ] **Step 1: Write the failing test**

Add inside the `tests` module:

```rust
    #[test]
    fn sanitizes_folder_names() {
        assert_eq!(sanitize_folder_name("阅读笔记"), "阅读笔记");
        assert_eq!(sanitize_folder_name("a/b\\c"), "a-b-c");
        assert_eq!(sanitize_folder_name("a:b*c?"), "a-b-c-");
        assert_eq!(sanitize_folder_name("  trimmed  "), "trimmed");
        assert_eq!(sanitize_folder_name("..."), "未命名");
        assert_eq!(sanitize_folder_name("   "), "未命名");
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml project::tests::sanitizes_folder_names`
Expected: FAIL to compile with "cannot find function `sanitize_folder_name` in this scope".

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/project.rs`:

```rust
/// Turn a user-supplied project name into a safe, cross-platform folder name.
/// Path separators and characters illegal on Windows become `-`; surrounding
/// whitespace and dots are trimmed; an empty result falls back to "未命名".
pub fn sanitize_folder_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "未命名".to_string()
    } else {
        trimmed.to_string()
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml project::tests::sanitizes_folder_names`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/project.rs
git commit -m "feat(project): sanitize project folder names"
```

---

### Task 4: `create_project` (scaffold the three files)

**Files:**
- Modify: `src-tauri/src/project.rs`

- [ ] **Step 1: Write the failing test**

Add inside the `tests` module:

```rust
    #[test]
    fn creates_project_with_scaffold_and_unique_name() {
        let root = tempdir();
        let entry = create_project(root.path(), "阅读笔记").unwrap();
        assert_eq!(entry.name, "阅读笔记");
        let dir = root.path().join("阅读笔记");
        assert!(is_project_dir(&dir));
        assert!(dir.join(TASKS_FILE).is_file());
        assert!(dir.join(DEFAULT_PIECE).is_file());

        // A second project with the same name gets a numeric suffix.
        let entry2 = create_project(root.path(), "阅读笔记").unwrap();
        assert_eq!(entry2.name, "阅读笔记 2");
        assert!(root.path().join("阅读笔记 2").join(INBOX_FILE).is_file());
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml project::tests::creates_project_with_scaffold_and_unique_name`
Expected: FAIL to compile with "cannot find function `create_project` in this scope".

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/project.rs`:

```rust
/// Pick a folder name under `root` that does not collide, appending " 2", " 3", …
fn unique_dir(root: &Path, base: &str) -> PathBuf {
    let mut candidate = root.join(base);
    let mut n = 2;
    while candidate.exists() {
        candidate = root.join(format!("{base} {n}"));
        n += 1;
    }
    candidate
}

/// Create a new project-space folder under `root`, scaffolding `_inbox.md`,
/// `_tasks.md`, and a default `piece.md` (all empty). Returns the created folder.
pub fn create_project(root: &Path, name: &str) -> std::io::Result<ProjectEntry> {
    let base = sanitize_folder_name(name);
    let dir = unique_dir(root, &base);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(INBOX_FILE), "")?;
    std::fs::write(dir.join(TASKS_FILE), "")?;
    std::fs::write(dir.join(DEFAULT_PIECE), "")?;
    Ok(ProjectEntry {
        name: dir.file_name().unwrap().to_string_lossy().to_string(),
        path: dir.to_string_lossy().to_string(),
    })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml project::tests::creates_project_with_scaffold_and_unique_name`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/project.rs
git commit -m "feat(project): create_project scaffolds the three files"
```

---

### Task 5: `list_pieces` (成品 notes in a project)

**Files:**
- Modify: `src-tauri/src/project.rs`

- [ ] **Step 1: Write the failing test**

Add inside the `tests` module:

```rust
    #[test]
    fn lists_pieces_excluding_underscore_files_newest_first() {
        let project = tempdir();
        std::fs::write(project.path().join(INBOX_FILE), "").unwrap();
        std::fs::write(project.path().join(TASKS_FILE), "").unwrap();
        std::fs::write(project.path().join("piece.md"), "").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        std::fs::write(project.path().join("draft.md"), "").unwrap();
        std::fs::write(project.path().join("ignore.txt"), "x").unwrap();

        let names: Vec<String> = list_pieces(project.path())
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(names, vec!["draft".to_string(), "piece".to_string()]);
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml project::tests::lists_pieces_excluding_underscore_files_newest_first`
Expected: FAIL to compile with "cannot find function `list_pieces` in this scope".

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/project.rs`:

```rust
/// List the 成品 notes inside a project folder: `.md` files whose name does not
/// start with `_`, newest-modified first. Returns `NoteEntry` so it slots into
/// the existing note-switching UI.
pub fn list_pieces(project: &Path) -> std::io::Result<Vec<NoteEntry>> {
    let mut entries: Vec<(std::time::SystemTime, NoteEntry)> = Vec::new();
    for entry in std::fs::read_dir(project)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("md") {
            continue;
        }
        let file_name = path.file_name().unwrap().to_string_lossy().to_string();
        if file_name.starts_with('_') {
            continue;
        }
        let modified = entry.metadata()?.modified()?;
        let name = path.file_stem().unwrap().to_string_lossy().to_string();
        entries.push((
            modified,
            NoteEntry {
                name,
                path: path.to_string_lossy().to_string(),
            },
        ));
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(entries.into_iter().map(|(_, entry)| entry).collect())
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml project::tests::lists_pieces_excluding_underscore_files_newest_first`
Expected: PASS (1 passed).

- [ ] **Step 5: Run the whole project module to confirm nothing regressed**

Run: `cargo test --manifest-path src-tauri/Cargo.toml project::`
Expected: PASS (5 passed).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/project.rs
git commit -m "feat(project): list_pieces excludes underscore system files"
```

---

### Task 6: Tauri commands + registration

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

These are thin pass-throughs with no independent logic, so they are verified by `cargo check` and the existing test suite rather than new unit tests (the logic is already covered by Tasks 2/4/5).

- [ ] **Step 1: Add the command wrappers**

In `src-tauri/src/commands.rs`, change the existing top-of-file import line:

```rust
use crate::{config::Config, notes, versions};
```

to add `project`:

```rust
use crate::{config::Config, notes, project, versions};
```

Then add these three commands at the end of the file (after `apply_shortcuts`, before `config_path`):

```rust
#[tauri::command]
pub fn list_projects(root: String) -> Result<Vec<project::ProjectEntry>, String> {
    project::list_projects(std::path::Path::new(&root)).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn create_project(root: String, name: String) -> Result<project::ProjectEntry, String> {
    project::create_project(std::path::Path::new(&root), &name).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_pieces(project_dir: String) -> Result<Vec<notes::NoteEntry>, String> {
    project::list_pieces(std::path::Path::new(&project_dir)).map_err(|error| error.to_string())
}
```

- [ ] **Step 2: Register the commands**

In `src-tauri/src/lib.rs`, add the three entries to the `tauri::generate_handler!` list (after `commands::rename_note,`):

```rust
            commands::rename_note,
            commands::list_projects,
            commands::create_project,
            commands::list_pieces,
```

- [ ] **Step 3: Verify it compiles**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: Finishes with no errors (warnings about not-yet-used items are acceptable). If `cargo check` reports an unused-import warning for `project` it means the wrappers were not added correctly — fix before continuing.

- [ ] **Step 4: Run the full backend test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — all existing `notes::` tests plus the 5 new `project::` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(project): expose list_projects/create_project/list_pieces commands"
```

---

## Self-Review

**Spec coverage (this plan's slice):** The spec's "项目空间" file model — folder = project, `_inbox.md`/`_tasks.md` as system files, non-underscore `.md` as 成品 (default `piece.md`), and "新建项目 = 建文件夹 + 铺三件套" — is implemented by `is_project_dir` (Task 1), `list_projects` (Task 2), `sanitize_folder_name` + `create_project` (Tasks 3–4), and `list_pieces` (Task 5), exposed via commands (Task 6). The spec's "新旧并存" is satisfied because `list_projects` skips loose `.md` files and non-project folders, leaving legacy flat notes untouched. Frontend navigation, the block view, 成品 switching UI, 清单, layout, and capture are explicitly out of scope here and covered by Plans 2–7.

**Placeholder scan:** No TBD/TODO/"handle edge cases" placeholders; every code step contains complete code and every test step a concrete command + expected result.

**Type consistency:** `ProjectEntry { name, path }` and the constants `INBOX_FILE`/`TASKS_FILE`/`DEFAULT_PIECE` are defined in Task 1 and used unchanged in Tasks 2/4/5/6. `list_pieces` returns `crate::notes::NoteEntry` (imported in Task 1), matching the existing note-switcher payload type. Command names `list_projects` / `create_project` / `list_pieces` are identical in `commands.rs` (Task 6 Step 1) and the `generate_handler!` registration (Task 6 Step 2). The command param `project_dir` is named to avoid shadowing the `project` module path inside `commands.rs`.
