# src-tauri/src — Rust backend

Tauri 2 backend. `lib.rs` wires modules, the managed `AppState`, the invoke
handler, tray, global shortcuts, window/shortcuts setup. `main.rs` is a thin
entry that calls `floatnote::run()`.

## Module map

- `state.rs` — the `AppState` root (managed state shared by all commands,
  the sidecar reader thread, popup, selection monitor). Constructed in
  `lib.rs::run` via `app.manage`.
- `commands.rs` — Tauri `#[tauri::command]` handler layer. Thin: delegates
  file/note ops to `notes`/`project`/`versions` per the convention that
  project-space file logic lives in `notes.rs`, not here.
- `agent.rs` — sidecar orchestration: stdin/stdout JSONL protocol types
  (`HostToSidecar`/`SidecarToHost`), spawn + read loop, target resolution,
  `handle_apply_edit`/`handle_apply_edit_at`. Largest backend module.
- `notes.rs` — note file read/write, `rename_note`/`delete_note`/`create_note`
  (atomic write, mtime), image path safety, project-space listing.
- `project.rs` — project-space discovery, pieces, `sanitize_folder_name`.
- `versions.rs` — snapshot/restore/purge per-note version history.
- `chat_history.rs` — `ChatHistoryStore` (~/.floatnote/chat-history).
- `paths.rs` — `user_home_dir()` / `floatnote_home()` (cross-platform).
- `watcher.rs` — `notify` file watcher + self-write suppress list
  (`mark_self_write` BEFORE writes to avoid TOCTOU; uses `into_inner()` to
  survive mutex poisoning).
- `source.rs` — macOS app-icon + browser source attribution (macOS-only).
- `capture.rs`, `ax_copy.rs`, `cursor.rs` — screen/cursor/accessibility capture.
- `popup.rs`, `selection_monitor.rs`, `shortcuts.rs`, `tray.rs`, `windows.rs`,
  `config.rs` — popup cache, selection monitor, global shortcuts, tray menu,
  window management, config load/save.
- `testutil.rs` — `#[cfg(test)]` shared `TempDir`/`tempdir()` for tests.

## Conventions

- `rustfmt`, snake_case, `serde`-serializable command payloads.
- Add project-space file operations to `notes.rs`/`project.rs`, not
  `commands.rs`.
- Verify backend changes with `cargo check` (and `cargo test --lib`) from
  `src-tauri/`; exercise flows with `npm run tauri dev`.
