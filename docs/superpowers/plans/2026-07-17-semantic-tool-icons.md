# Semantic Tool Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render assistant tool rows with safe semantic labels and distinct icons, including dedicated Skill, web-search, and web-fetch presentations.

**Architecture:** The sidecar classifies every tool call once from its trusted tool name and safe arguments, returning both `label` and `category` for live events and restored history. Rust transports the category unchanged. The assistant reducer stores it and the action-card renderer maps the semantic category to a fixed inline SVG.

**Tech Stack:** TypeScript, Vitest/jsdom, Rust/serde, Tauri event protocol.

## Global Constraints

- Never render raw tool arguments, result bodies, query strings, or absolute Skill paths.
- Use semantic categories rather than one icon component per tool.
- Keep the existing 16px, 1.5px-stroke inline SVG visual language.
- Preserve unknown-tool compatibility with an `other` category and gear icon.
- Keep live tool events and restored session blocks consistent.

---

### Task 1: Sidecar semantic tool presentation

**Files:**
- Modify: `sidecar/src/tool-title.ts`
- Test: `sidecar/src/tool-title.test.ts`
- Modify: `sidecar/src/event-translate.ts`
- Modify: `sidecar/src/runner.ts`
- Modify: `sidecar/src/protocol.ts`

**Interfaces:**
- Produces: `ToolCategory` and `formatToolPresentation(name, args): { label: string; category: ToolCategory }`.
- Keeps: `formatToolTitle(name, args): string` as a compatibility wrapper.

- [x] Add failing table tests for every active tool category and Skill paths ending in `<skill-name>/SKILL.md`.
- [x] Run `npm test -- sidecar/src/tool-title.test.ts` and confirm category assertions fail because the presentation API does not exist.
- [x] Implement safe Skill-name extraction and semantic classification; emit `category` in live and restored tool blocks.
- [x] Run the focused sidecar tests and confirm they pass.

### Task 2: Protocol transport and assistant state

**Files:**
- Modify: `src-tauri/src/agent/protocol.rs`
- Test: `src-tauri/src/agent/protocol.rs`
- Modify: `src/platform/agent.ts`
- Modify: `src/assistant/render/state.ts`
- Test: `src/assistant/render.test.ts`

**Interfaces:**
- Consumes: sidecar `ToolCategory` serialized as snake-case strings.
- Produces: `ActionBlock.category` for rendering.

- [x] Add failing protocol/reducer assertions that a `skill` category survives JSON deserialization and history restoration.
- [x] Run the focused TypeScript and Rust tests and confirm the new assertions fail.
- [x] Add the shared category unions/enums and propagate `category` through tool events, history blocks, and reducer state.
- [x] Re-run focused protocol and reducer tests and confirm they pass.

### Task 3: Semantic icon rendering

**Files:**
- Modify: `src/assistant/action-card.ts`
- Test: `src/assistant/action-card.test.ts`

**Interfaces:**
- Consumes: `ActionBlock.category`.
- Produces: `.chat-action-icon[data-tool-category="..."]` containing a category-specific SVG.

- [x] Add failing jsdom cases for `skill`, `web_search`, `web_fetch`, and `other`, asserting distinct SVG paths and accessible category markers.
- [x] Run `npm test -- src/assistant/action-card.test.ts` and confirm the assertions fail against the current tool-name icon switch.
- [x] Replace the tool-name switch with a semantic-category SVG map and gear fallback.
- [x] Re-run the focused action-card tests and confirm they pass.

### Task 4: Documentation and verification

**Files:**
- Modify: `sidecar/AGENTS.md`
- Modify: `src/assistant/AGENTS.md`
- Modify: `docs/architecture/data-flow.md`

- [x] Document that safe tool presentation contains both label and semantic category.
- [x] Run `npm test` and `npm run build` from the repository root.
- [x] Run `cargo test --lib`, `cargo check`, and `cargo check --release` from `src-tauri/`.
- [x] Review `git diff --check`, `git diff`, and `git status --short` for accidental or unrelated changes.
