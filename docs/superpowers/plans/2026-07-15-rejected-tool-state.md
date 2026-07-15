# Rejected Tool State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a user-denied write operation as a persistent amber tool-row state without treating it as an execution failure or adding result text.

**Architecture:** Bind a permission request to its existing chat action by `toolCallId`, then model denial as `execution: "rejected"`. A normal sidecar `tool_end` after denial must preserve this terminal state. CSS consumes a new semantic warning token for the row title and icon.

**Tech Stack:** TypeScript, Vitest, CSS semantic tokens.

## Global Constraints

- Keep permission approval exclusively in the dock bubble; chat rows remain non-interactive.
- Keep successful rows gray and true execution failures red.
- Do not display an “已拒绝” outcome message or change process-group summary counts.
- Preserve light and dark theme support through semantic tokens.

---

### Task 1: Model and test the rejected terminal state

**Files:**
- Modify: `src/assistant/render.test.ts`
- Modify: `src/assistant/render/state.ts`

**Interfaces:**
- Consumes: `permission_request` with `requestId` and `callId`.
- Produces: `ActionBlock.execution` including `"rejected"`.

- [ ] **Step 1: Write a failing reducer test**

  Start an `edit_note` action, associate a permission request with the same `callId`, resolve it with `deny`, then send a non-error tool end. Assert the action has the request id and remains `decision: "denied", execution: "rejected"`.

- [ ] **Step 2: Run the focused test and verify it fails**

  Run: `npm test -- src/assistant/render.test.ts`

- [ ] **Step 3: Implement the minimum reducer behavior**

  In `fillActionBlock`, match the pending action by `callId` and attach only `requestId`. Change deny resolution to `execution: "rejected"`, and make the tool-end reducer leave a rejected action unchanged.

- [ ] **Step 4: Run the focused test and verify it passes**

  Run: `npm test -- src/assistant/render.test.ts`

### Task 2: Render the semantic warning state

**Files:**
- Modify: `src/styles/semantic.css`
- Modify: `src/styles/tokens.test.ts`
- Modify: `src/assistant/action-card.ts`
- Modify: `src/assistant/styles.css`

**Interfaces:**
- Consumes: `ActionBlock.execution === "rejected"`.
- Produces: `.chat-action-rejected` with amber title and icon styling only.

- [ ] **Step 1: Write failing token and DOM-state assertions**

  Assert the warning token exists for both color schemes and action-card updates apply `chat-action-rejected` when execution is rejected.

- [ ] **Step 2: Run focused tests and verify failure**

  Run: `npm test -- src/styles/tokens.test.ts src/assistant`

- [ ] **Step 3: Add the smallest visual change**

  Define light/dark `--color-warning` in `semantic.css`. Toggle `chat-action-rejected` from execution rather than decision, suppress any rejected result text, and color only the tool row title/icon with the warning token.

- [ ] **Step 4: Verify regression coverage**

  Run: `npm test -- src/assistant/render.test.ts src/assistant/action-card.test.ts src/styles/tokens.test.ts`

### Task 3: Verify the affected frontend suite

**Files:**
- No production files.

- [ ] **Step 1: Run the frontend test suite**

  Run: `npm test`

- [ ] **Step 2: Run the production build**

  Run: `npm run build`
