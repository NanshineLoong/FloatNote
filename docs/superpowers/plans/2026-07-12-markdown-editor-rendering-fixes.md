# Markdown Editor Rendering Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make nested-list rendering and folding stable, preserve IME composition text, align the writing title, and make blank-line selection compact.

**Architecture:** Keep list hierarchy decisions in the live-preview decoration builder and store folding state in the existing list-fold field. During IME composition, map decorations through the document change rather than rebuilding widgets or hidden ranges. Styling remains scoped to CodeMirror classes and the writing pane.

**Tech Stack:** TypeScript, CodeMirror 6, Vitest, CSS.

## Global Constraints

- Preserve Markdown source and cross-platform behavior.
- Do not modify unrelated user changes already in the worktree.
- Keep CodeMirror selection semantics intact; only change its rendering for blank lines.

---

### Task 1: Stabilize nested-list presentation and folding

**Files:**
- Modify: `src/note/preview/builder.ts`
- Modify: `src/note/list-fold.ts`
- Modify: `src/styles.css`
- Test: `src/note/list-fold.test.ts`

- [ ] Write a regression test for a three-level list asserting that every non-cursor list parent still has a visible marker decoration while fold state is applied.
- [ ] Run `npm test -- src/note/list-fold.test.ts` and confirm the new assertion fails against the nested-marker behavior.
- [ ] Render a compact chevron button before the preserved list marker, use a block replacement decoration for the folded descendant range, and remove the descendant count UI.
- [ ] Run `npm test -- src/note/list-fold.test.ts` and confirm it passes.

### Task 2: Preserve CJK IME composition

**Files:**
- Modify: `src/note/preview/builder.ts`
- Test: `src/note/preview.test.ts`

- [ ] Write a regression test for an `input.type.compose` transaction asserting existing preview decorations are mapped instead of rebuilt.
- [ ] Run `npm test -- src/note/preview.test.ts` and confirm it fails.
- [ ] Map the current preview DecorationSet for compose transactions, rebuilding only after composition completes.
- [ ] Run `npm test -- src/note/preview.test.ts` and confirm it passes.

### Task 3: Align writing title and compact blank-line selection

**Files:**
- Modify: `src/styles.css`
- Test: `src/note/split-css.test.ts`

- [ ] Add source-level CSS assertions that the title header shares the editor content inset and that blank selection fragments are visually constrained.
- [ ] Run `npm test -- src/note/split-css.test.ts` and confirm the assertions fail.
- [ ] Apply the smallest scoped CSS rules for the shared writing inset and blank-line selection appearance.
- [ ] Run `npm test -- src/note/split-css.test.ts` and confirm it passes.

### Task 4: Verify the editor surface

**Files:**
- Test: `src/note/list-fold.test.ts`, `src/note/preview.test.ts`, `src/note/split-css.test.ts`

- [ ] Run the focused test suites.
- [ ] Run `npm test` and `npm run build` to validate the TypeScript application and bundled sidecar.
- [ ] Inspect the final diff to ensure only the planned editor files and test/docs files changed.
