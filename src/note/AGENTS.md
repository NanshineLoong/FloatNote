# src/note — note window

The main note window (CodeMirror 6 editor + inbox/pieces/tasks + assistant).
Entry: `main.ts` calls `startNoteApp()` in `note-app.ts`. Two CM6 editors
(inbox + piece) share live preview; Inbox additionally owns range annotations.

## Module map

- `notes-state.ts` — Tauri call wrappers (read/list/create/rename/delete) +
  per-path debounced save queue (`scheduleSave`/`saveImmediate`/`flushAll`)
  with mtime conflict guard. `loadNote` registers last-known mtime.
- `editor.ts` — CM6 editor construction, highlight style, insert helpers.
- `preview/` — live-preview StateField split into `builder.ts`, `widgets.ts`,
  and `icons.ts`.
- `tasks-panel.ts` — `_tasks.md` checklist panel (render, mutate, drag-reorder,
  filter). Imports task logic from `./tasks` (migrated from shared).
- `annotations/` — Inbox clean-projection metadata `StateField`, v2 autosave,
  inline decoration, selection context menu, and read-only segmented filter
  projection. `tags/bar.ts` manages definitions and selects the active filter;
  `tags/palette.ts` re-exports the canonical palette.
- `piece-switcher.ts`, `seg-switch.ts`, `split.ts`, `layout*.ts`,
  `topbar.ts` — layout/view switching.
- `image-*.ts` — image drop/resize/toolbar/attrs/fs. Block image widgets carry
  exact source offsets in DOM data attributes; toolbar writeback must use those
  offsets and must never infer image identity from caption text.
- `chat-history.ts` / `chat-history-format.ts` — compatibility re-exports;
  new callers use `src/platform/chat-history*`.
- `recent-projects.ts` — MRU list helpers.
- `agent.ts` — compatibility re-export; the frontend↔Rust bridge lives in
  `src/platform/agent.ts`.
- `append.ts`, `paste.ts`, `quote.ts` (quote-card-specific ranges and minimal
  append), `table.ts`/`table-keymap.ts`,
  `list-indent.ts`/`list-keymap.ts`, `markdown-keymap.ts`, `inline.ts`, `empty-state.ts`,
  `versions.ts`, `window-state.ts`, `shortcuts.ts`, `scrollbar.ts`,
  — focused editor helpers.

Tests: `*.test.ts` next to each module (Vitest, pure-logic style).
