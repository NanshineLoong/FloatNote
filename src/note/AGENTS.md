# src/note — note window

The main note window (CodeMirror 6 editor + inbox/pieces/tasks + outline +
assistant). Entry: `main.ts` (init, event wiring). Two CM6 editors
(inbox + piece) share preview/outline/tag decorations.

## Module map

- `notes-state.ts` — Tauri call wrappers (read/list/create/rename/delete) +
  per-path debounced save queue (`scheduleSave`/`saveImmediate`/`flushAll`)
  with mtime conflict guard. `loadNote` registers last-known mtime.
- `editor.ts` — CM6 editor construction, highlight style, insert helpers.
- `preview.ts` — live-preview StateField: syntax-tree decoration builder +
  widget classes (bullet/ol/hr/img/link/checkbox/table/quote-card) + app-icon
  cache. Largest module here.
- `outline-mode.ts` / `outline-tree.ts` / `outline-edit.ts` — outline StateField,
  outline parsing, and edit commands.
- `tasks-panel.ts` — `_tasks.md` checklist panel (render, mutate, drag-reorder,
  filter). Imports task logic from `./tasks` (migrated from shared).
- `tags/` — tag system: `bar.ts` (gutter bar), `palette.ts` (re-exports
  canonical `PALETTE`/`freeColors` from `@floatnote/note-logic`, + `tint`),
  `picker.ts`, `decoration.ts`, `filter.ts`, `floating.ts` (floating menu
  helper used across the note window + assistant pickers).
- `blocks/` — `drag.ts` (block reorder), `handle-gutter.ts` (gutter handle).
- `piece-switcher.ts`, `seg-switch.ts`, `split.ts`, `layout*.ts`,
  `topbar.ts` — layout/view switching.
- `image-*.ts` — image drop/resize/toolbar/attrs/fs.
- `chat-history.ts` / `chat-history-format.ts` — chat conversation Tauri
  wrappers + display formatting.
- `recent-projects.ts` — MRU list helpers.
- `agent.ts` — frontend↔Rust agent bridge (`agent://event`, `note://updated`).
- `append.ts`, `paste.ts`, `quote.ts`, `table.ts`/`table-keymap.ts`,
  `list-indent.ts`/`list-keymap.ts`, `inline.ts`, `empty-state.ts`,
  `versions.ts`, `window-state.ts`, `shortcuts.ts`, `scrollbar.ts`,
  `preview.ts` — focused editor helpers.

Tests: `*.test.ts` next to each module (Vitest, pure-logic style).
