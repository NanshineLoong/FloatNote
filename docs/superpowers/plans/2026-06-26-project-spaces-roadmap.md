# Project Spaces — Plan Roadmap (计划的计划)

Tracks the sequence of implementation plans for the FloatNote project-spaces feature.
Spec: [`../specs/2026-06-26-project-spaces-design.md`](../specs/2026-06-26-project-spaces-design.md)

## Working rhythm

**Write one plan at a time. Write Plan N+1 only after Plan N has landed** (implemented, tests green, committed/merged). Reason: each plan's exact file paths, function names, and UI seams depend on what the previous plan actually produced — writing them all upfront bakes in guesses that go stale. The roadmap below is the stable skeleton; the per-plan detail docs get written just-in-time.

When a plan lands: tick its box here, note the plan doc path, then invoke `superpowers:writing-plans` for the next one.

## Sequence

Each plan ships working, independently-testable software. Later plans depend on earlier ones.

- [ ] **Plan 1 — Backend data layer** · `2026-06-26-project-spaces-backend.md` (written)
  - Rust `project.rs`: `is_project_dir`, `list_projects`, `sanitize_folder_name`, `create_project`, `list_pieces`; three Tauri commands.
  - Ships: backend can enumerate/create project spaces and list a project's 成品. Cargo-tested. Not yet user-visible.
  - Depends on: nothing.

- [x] **Plan 2 — Project navigation (frontend)** · `2026-06-26-project-spaces-frontend-nav.md` (implemented; pending interactive `tauri dev` smoke test)
  - Topbar left becomes a **project-space switcher** (lists folders from `list_projects`, switch/create); on open, load the project's `_inbox.md` as the current document. New-project flow calls `create_project`.
  - Ships: user can create/switch project spaces and edit their markdown. First user-visible milestone.
  - Depends on: Plan 1. Touches `src/note/main.ts`, `topbar.ts`, `notes-state.ts`.

- [x] **Plan 3 — Inbox block view** · `2026-06-26-project-spaces-inbox-blocks.md` (implemented; pending interactive `tauri dev` smoke test)
  - Parse `_inbox.md` into top-level Markdown blocks; render clip callouts / todos / text as cards with hover handles; drag-reorder and delete blocks; serialize back to Markdown. Pure parse/serialize helpers are Vitest-tested.
  - Ships: the lightweight block editor for Inbox.
  - Depends on: Plan 2. New `src/note/blocks/` module + editor wiring.
  - Design notes folded into the plan doc (approved via brainstorming): CodeMirror stays source of truth, block view is a render+manipulate layer; structural-only (no inline text edit) + a topbar source toggle; each `- [ ]` line is its own draggable block.

- [ ] **Plan 4 — 成品 multi-file switcher + rename**
  - 成品 space gets its own note switcher (uses `list_pieces`): switch among a project's 成品, create new, rename in place. Reuses existing editor/preview + rename command.
  - Ships: multiple 成品 per project.
  - Depends on: Plan 2 (and Plan 1's `list_pieces`).

- [ ] **Plan 5 — 清单 panel**
  - Toggleable panel bound to `_tasks.md`: render `- [ ]` items, add, check (`- [x]` → strikethrough), only the current project. Write-back on toggle.
  - Ships: the third space.
  - Depends on: Plan 2.

- [ ] **Plan 6 — Split layout + right-slot assistant**
  - Extend `src/note/layout.ts`: a width-gated split toggle (Inbox ｜ 成品); the "right slot" rule — inline assistant in single-pane, assistant forced to floating when split is on. Pure layout math is Vitest-tested (existing `layout.test.ts` pattern).
  - Ships: the width-driven capture/organize behavior.
  - Depends on: Plans 2–4 (needs both panes to exist).

- [ ] **Plan 7 — Capture into current project's `_inbox.md`**
  - Rewire the existing capture/quote flow (`quote-captured` event, `capture.rs`/`quote.rs`) to append a clip block to the **current project's** `_inbox.md` instead of the active flat note.
  - Ships: end-to-end "read → drop into Inbox".
  - Depends on: Plans 2–3.

## Out of scope (whole feature, per spec)

No 提炼 mechanic, no global Inbox, no cross-project 清单, no full Notion block engine, no migration of legacy flat notes, no three-column ultra-wide layout.
