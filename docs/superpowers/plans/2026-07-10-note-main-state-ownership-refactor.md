# Note Window State Ownership Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `src/note/main.ts` as a mixed composition root/controller with collaborating note-window modules that have explicit state ownership.

**Architecture:** `note-app.ts` will assemble the DOM and controllers. `note-session.ts` will own the current project/document/piece/surface state. Controllers will own their own resources and receive narrow transition callbacks rather than sharing module globals. The existing `project-menu-render.ts` remains the DOM-only menu renderer.

**Tech Stack:** Vanilla TypeScript, CodeMirror 6, Tauri 2, Vitest.

## Global Constraints

- Preserve existing project/document/MRU/autosave and watcher behavior.
- Keep Windows and macOS filesystem handling portable.
- Do not modify unrelated dirty-worktree changes.

---

### Task 1: Establish note-session ownership

**Files:**
- Create: `src/note/note-session.ts`
- Test: `src/note/note-session.test.ts`

- [ ] Add tests that assert project/document transitions and active-piece selection.
- [ ] Implement `NoteSession` as the single owner of project, inbox, document, piece, MRU, surface, and outline session state.
- [ ] Run `npm run test:frontend -- src/note/note-session.test.ts`.

### Task 2: Move startup assembly out of the entry point

**Files:**
- Create: `src/note/note-app.ts`
- Modify: `src/note/main.ts`

- [ ] Move note-window startup behind `startNoteApp`.
- [ ] Leave `main.ts` as style imports and one startup call.
- [ ] Run `npm run build:frontend`.

### Task 3: Extract controller boundaries

**Files:**
- Create: `src/note/editor-controller.ts`, `src/note/project-controller.ts`, `src/note/assistant-controller.ts`, `src/note/event-wiring.ts`
- Modify: `src/note/note-app.ts`

- [ ] Move each resource-owning lifecycle behind one factory with explicit dependencies.
- [ ] Route all project/document transitions through `NoteSession`.
- [ ] Keep project-switcher DOM construction in `project-menu-render.ts`.

### Task 4: Verify behavior-preserving refactor

**Files:**
- Modify: `src/note/*.test.ts` as needed

- [ ] Run focused session/controller tests.
- [ ] Run `npm run test:frontend` and `npm run build:frontend`.
