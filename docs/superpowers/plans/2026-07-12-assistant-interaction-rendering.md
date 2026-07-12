# Assistant Interaction Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the assistant conversation render submitted references, compact tool titles, and purpose-specific write confirmations without persisting tool UI entries.

**Architecture:** Keep structured references on in-memory user messages so `view.ts` can render chips. Reduce every tool event to a compact action row; permission requests remain in the dock bubble and disappear after resolution. Split write confirmation presentation by tool name while reusing the safe assistant Markdown renderer.

**Tech Stack:** Vanilla TypeScript, DOM APIs, Vitest/jsdom, existing assistant Markdown renderer.

## Global Constraints

- Keep tool result data available to the active AI turn; only suppress UI/history display records.
- No `src/note/` imports from `src/assistant/`.
- Use Markdown rendering for document contents and keep all content inside bounded, scrollable panels.

---

### Task 1: Conversation state and Markdown primitives

**Files:**
- Modify: `src/assistant/render/state.ts`
- Modify: `src/assistant/render/view.ts`
- Modify: `src/assistant/markdown.ts`
- Test: `src/assistant/render.test.ts`
- Test: `src/assistant/blocks.test.ts`
- Test: `src/assistant/markdown.test.ts`

- [ ] Add failing tests for structured user references, compact tool actions, and `---` horizontal rules.
- [ ] Run `npm test -- src/assistant/render.test.ts src/assistant/blocks.test.ts src/assistant/markdown.test.ts` and confirm failures.
- [ ] Store references with user chat state, render file/Skill chips, emit one compact action title per tool, and add a horizontal-rule block renderer.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Compact permission confirmations

**Files:**
- Modify: `src/assistant/permission-bubble.ts`
- Modify: `src/assistant/styles.css`
- Test: `src/assistant/permission-bubble.test.ts`

- [ ] Add failing tests proving only `write_note` has the snapshot selection and document previews render as Markdown panels.
- [ ] Run `npm test -- src/assistant/permission-bubble.test.ts` and confirm failures.
- [ ] Simplify tag/create-note confirmation content; use separate `write_note`/`edit_note` preview panels; limit confirmation width and make controls fit narrow Floating layouts.
- [ ] Re-run the focused test and confirm it passes.

### Task 3: Transient tool UI and persisted-history filtering

**Files:**
- Modify: `src/assistant/assistant.ts`
- Modify: `src/assistant/render/state.ts`
- Modify: `sidecar/src/runner.ts`
- Test: `src/assistant/render.test.ts`
- Test: `sidecar/src/agent.test.ts`

- [ ] Add failing tests proving resolved permission cards leave only compact result rows and restored sessions omit tool UI history.
- [ ] Run focused frontend and sidecar tests, then implement removal/filtering.
- [ ] Run `npm test` and `npm run build` for end-to-end verification.
