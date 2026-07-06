# Standalone Documents — Design Spec

**Date:** 2026-07-06
**Status:** Draft (pending user review)
**Related:** `docs/superpowers/specs/2026-06-26-project-spaces-design.md`

## Goal

FloatNote currently treats every note as belonging to a **project space** (a subfolder containing `_inbox.md`). The main window always opens into a project and exposes a 采集/写作/双栏 (inbox/piece/split) mode slider plus a piece switcher.

This spec adds a second entity type — the **standalone document** — a single `.md` file anywhere on disk, not inside any project. Standalone documents open in a simplified **document mode** with no mode slider and no piece switcher: just the one file in the editor. Projects and documents are listed in separate, icon-distinguished sections of the top-left switcher, and either can be created directly.

It also fills two missing operations that block normal use: **rename/delete for projects** (both absent today) and **delete for pieces** (rename exists, delete is absent).

## Non-goals

- **No data link between a document and a project.** A document "serving as a project outline" is a *use case* (you write an outline in a doc), not an attachment mechanism. No association field is introduced.
- **No multi-window.** The single main note window toggles between project mode and document mode; it does not open one document per OS window.
- **No migration of legacy loose `.md` notes** into the new document list beyond surfacing whatever the user opens via the file picker.
- **No new read/write file path.** Documents reuse the existing generic `read_note`/`write_note`/`rename_note` commands.

## Background (current architecture)

- **Project** = subfolder containing `_inbox.md`. `is_project_dir` (`src-tauri/src/project.rs:19-21`). `list_projects` reads the working dir; `list_pieces` lists non-`_`-prefixed `.md` within a project.
- **Top-left switcher** is a dropdown anchored on the project-name button (`src/note/topbar.ts:43-45`), built by `showProjectSwitcher` (`src/note/main.ts:350-388`). It lists MRU projects from `resolveProjects` and offers "new project" entries.
- **Mode slider** 采集/写作/双栏: `#view-seg` in `topbar.ts:47-54`; pure logic in `src/note/seg-switch.ts`; wired via `wireSegSwitch` → `onSelectView` (`main.ts:457-467`).
- **Piece editor** (`#piece-editor-root`) operates on a file path through `read_note`/`write_note`; rename via `commitRename` (`src/note/piece-switcher.ts:92-111`) → `rename_note` (`src-tauri/src/commands.rs:83-90`) → `notes::rename_note` + `versions::rename`.
- **Config** holds `recent_projects: Vec<String>` (`src-tauri/src/config.rs`); MRU helpers in `src/note/recent-projects.ts`.
- **Active note** is published per-focus via `set_active_note` so the agent sidecar's `apply_write` can locate the file.

## Design

### 1. Data model & config

- Two entity types: **project** (subfolder with `_inbox.md`, unchanged) and **document** (a single `.md` file anywhere, not inside a project).
- `Config` gains `recent_documents: Vec<String>` alongside `recent_projects`, persisted the same way.
- `src/note/recent-projects.ts` gets a parallel `pushRecentDocument` (cap 8, identical shape to `pushRecent`). `parentDir` is reused as-is.
- Backend `resolve_documents(paths: Vec<String>) -> Vec<NoteEntry>` mirrors `resolve_projects`: it drops entries whose file no longer exists and returns `NoteEntry` (name = file stem, path = absolute).

### 2. Top-left switcher — sectioned

`showProjectSwitcher` (`main.ts:350-388`) is restructured into two labeled sections:

- **项目** — Phosphor `folder` icon; items from `resolveProjects(recent)`.
- **文档** — Phosphor `file` icon; items from `resolveDocuments(recent)`.

Action rows below the sections: **新建项目** (existing "在当前目录新建" / "选择位置新建…" entries, unchanged) and a new **新建文档** entry. New-document flow: open the OS save dialog (`@tauri-apps/plugin-dialog` `save`), write an empty file via `write_note(path, "")`, push to `recent_documents`, and open it in document mode.

### 3. Document mode view

Main window gains `mode: "project" | "document"` and `currentDocument: NoteEntry | null`.

Opening a document:
1. `mode = "document"`; `currentProject` is left as-is (not cleared) so returning to project mode reopens the last project.
2. Hide `#view-seg` (the slider), the inbox column, the tasks toggle, and the piece breadcrumb/switcher (`#piece-doc-header` multi-piece UI).
3. Show a minimal **doc header**: the document filename as an editable title (rename, §5) + an always-visible trash button (delete, §5).
4. Point the piece editor (`#piece-editor-root`) at `currentDocument.path`; load via `read_note`.
5. `set_active_note(doc.path)` on focus so the agent sidecar's `apply_write` keeps working.
6. Autosave reuses `scheduleSave` pointed at the doc path.

Opening a project sets `mode = "project"`, restores the full top bar (slider + piece switcher + tasks toggle), and reloads the project's inbox/pieces as today.

`applyView` / `setViewSeg` are extended to short-circuit in document mode: when `mode === "document"`, the slider is hidden and the view is forced to the single document editor regardless of `surface`/`split`.

### 4. Piece-editor decoupling

Generalize the piece editor off `currentProject.path` onto a small context object:

```ts
currentFileContext = { dir: string; name: string; path: string }
```

- Project mode: `{ dir: currentProject.path, name: currentPiece.name, path }`.
- Document mode: `{ dir: parentDir(doc.path), name: doc.name, path: doc.path }`.

`commitRename`, piece loading, and autosave read from `currentFileContext` instead of `currentProject.path` directly. The piece *switcher* (multi-file breadcrumb dropdown) remains project-mode-only; in document mode there is exactly one file and no switcher.

This is a deliberate boundary improvement: the editor becomes file-bound rather than project-bound.

### 5. Rename & delete interactions

**Row structure.** `.switch-item` becomes a flex container: a label area (the open target) plus hover-revealed action buttons (pencil ✏️ for rename, trash 🗑 for delete), both keyboard-focusable. This replaces the current single-`<button>` row to avoid button-in-button nesting.

**Rename** (project, piece, document): click pencil → the row/title swaps to an inline `<input>` prefilled with the current name; Enter commits, Esc/blur cancels. Reuses the swap pattern from `promptNewProjectName` (`main.ts:423-451`) and the piece title (`piece-switcher.ts:58-64`).
- Project rename: new `rename_project(root, old, new)` → `project::rename_project` (sanitize folder name, error on conflict); update the `recent_projects` entry to the new path.
- Piece rename: already works via `rename_note` — unchanged.
- Document rename: reuse `rename_note(dir, old, new)` with `dir = parentDir(doc.path)`; update `recent_documents` entry.

**Delete** (project, piece, document): click trash → native confirm dialog (Tauri message dialog) → trash-if-available else `std::fs::remove_file`/`remove_dir_all` → drop the entry from the relevant MRU list → refresh the UI.
- Project delete: new `delete_project(path)`; on success, drop from `recent_projects`. If the deleted project was active, return to the switcher (or open the MRU's next project).
- Piece delete: new `delete_note(path)` (generic, any `.md`); after delete, reload `list_pieces` and select the next piece, or create a fresh piece if none remain.
- Document delete: reuse `delete_note(path)`; after delete, return to the last project or show the switcher.

**Trash handling.** Prefer `tauri-plugin-fs` trash if the capability is configured; otherwise fall back to permanent `remove_file`/`remove_dir_all` with a confirm dialog that makes the permanence explicit. Confirm which path is available during implementation planning.

**Affordance placement by surface.**
- Top-left switcher dropdown rows (projects, documents): hover-reveal pencil + trash.
- Piece breadcrumb dropdown rows (`piece-switcher.ts:openMenu`): hover-reveal trash (rename stays via the piece title, as today).
- Document-mode header: always-visible trash beside the editable title (a header is not a hover row).

### 6. New Tauri commands

Registered in `src-tauri/src/commands.rs` and added to the `invoke_handler!` list in `src-tauri/src/lib.rs:107-136`:

| Command | Purpose |
|---|---|
| `rename_project(root, old, new)` | Rename a project folder; sanitize + conflict check; update MRU. |
| `delete_project(path)` | Trash/remove a project folder; drop from MRU. |
| `delete_note(path)` | Trash/remove any `.md` (piece or document). |
| `resolve_documents(paths)` | Filter a recent-documents list to existing files; mirror of `resolve_projects`. |
| `remember_document(path)` | Push to `recent_documents` MRU (cap 8). |

`create_document` needs no dedicated command: the frontend uses the OS save dialog then `write_note(path, "")`.

Backend logic lives in `project.rs` (`rename_project`, `delete_project`, `resolve_documents`) and `notes.rs` (`delete_note`), per the convention of extending `notes.rs`/`project.rs` rather than ad-hoc file logic in `commands.rs`.

### 7. Testing

**Rust (`src-tauri/`):**
- Extend `project.rs` tests: `rename_project` (success, name sanitization, conflict error), `delete_project` (folder removed, MRU pruned), `resolve_documents` (missing files dropped).
- `notes.rs`: `delete_note` (file removed; no-op-on-missing vs error — decide and test).
- `cargo check` minimum gate; exercise the flows with `npm run tauri dev`.

**Frontend (Vitest, `*.test.ts` next to source):**
- `currentFileContext` resolution in both modes (project vs document).
- Switcher sectioning: projects and documents render in separate sections with the right icons; empty section hidden.
- `mode` toggle hides `#view-seg`, inbox, tasks toggle in document mode; restores them in project mode.
- Rename inline-input swap (Enter commits, Esc cancels) and delete confirm flow (state transitions, MRU pruning, next-selection logic).

## Open questions for planning

- Confirm whether `tauri-plugin-fs` trash is available/configured; if not, finalize the permanent-delete confirm copy.
- Decide `delete_note` semantics when the file is missing (no-op vs error) — likely no-op to keep the UI forgiving, but confirm.
- Accessibility: exact keyboard model for hover-revealed row actions (Tab order, Esc to dismiss).

## Platform impact

- Path separators and line endings handled portably (existing convention).
- OS save/open dialogs are cross-platform via `@tauri-apps/plugin-dialog`.
- Trash behavior may differ Windows vs macOS; verify on both before relying on it (hence the permanent-delete fallback).
