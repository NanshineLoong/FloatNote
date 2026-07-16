# Built-in Skills Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace FloatNote's three built-in Skills with four interactive Skills and show localized Chinese metadata without changing stable English Skill IDs.

**Architecture:** Keep `SKILL.md` as the source of truth. Parse optional namespaced UI strings from its standard `metadata` map in the Rust catalog, return localized fields to both settings and assistant UI, and fall back to the existing fields for imported Skills.

**Tech Stack:** Rust/serde_yaml/Tauri, TypeScript/Vitest, Agent Skills `SKILL.md`.

## Global Constraints

- Internal folder names and Skill IDs remain lowercase English names.
- Chinese UI strings live in `metadata.floatnote-display-name` and `metadata.floatnote-short-description`.
- External Skills without FloatNote metadata retain current behavior through fallback values.
- `write` has no fixed interaction limit.

---

### Task 1: Localized Skill catalog contract

**Files:**
- Modify: `src-tauri/src/commands/agent.rs`
- Modify: `src/platform/agent.ts`

**Interfaces:**
- Produces: catalog entries with `name`, `description`, `displayName`, `displayDescription`, `source`, and `enabled`.

- [x] Add a Rust catalog test whose `SKILL.md` contains both FloatNote metadata fields and assert the localized values.
- [x] Run `cargo test --lib skill_catalog_tests` and verify the new assertion fails because the fields do not exist.
- [x] Extend `SkillMetadata`, `SkillCatalogEntry`, and YAML parsing with optional metadata plus fallbacks.
- [x] Update the frontend `Skill` type with `displayName` and `displayDescription`.
- [x] Re-run the focused Rust tests and verify they pass.

### Task 2: Localized assistant and settings presentation

**Files:**
- Modify: `src/assistant/skill-picker.ts`
- Modify: `src/assistant/input/composer.ts`
- Modify: `src/assistant/input/composer.test.ts`
- Modify: `src/settings/skills.ts`

**Interfaces:**
- Consumes: the localized catalog contract from Task 1.
- Produces: Chinese candidate labels/descriptions while keeping `ref.id = skill.name`.

- [x] Add a composer test that selects a localized Skill and asserts the inserted reference has English `id` and Chinese `display`.
- [x] Run the focused Vitest and verify it fails because candidates still display `name`.
- [x] Render/filter `displayName` and `displayDescription`; use `name` only as the stable dataset/reference ID.
- [x] Render localized fields in settings while keeping toggles keyed by `name`.
- [x] Re-run focused frontend tests and verify they pass.

### Task 3: Replace built-in Skills and documentation

**Files:**
- Delete: `src-tauri/resources/skills/inbox-to-actions/SKILL.md`
- Delete: `src-tauri/resources/skills/socratic-review/SKILL.md`
- Delete: `src-tauri/resources/skills/structure-piece/SKILL.md`
- Create: `src-tauri/resources/skills/organize/SKILL.md`
- Create: `src-tauri/resources/skills/tutor/SKILL.md`
- Create: `src-tauri/resources/skills/plan-actions/SKILL.md`
- Create: `src-tauri/resources/skills/write/SKILL.md`
- Modify: `docs/architecture/backend.md`
- Modify: `docs/architecture/frontend.md`

**Interfaces:**
- Produces: four built-in Skills with English runtime metadata and Chinese FloatNote UI metadata.

- [x] Replace the three resource directories with the four confirmed Skill documents.
- [x] Update architecture documentation for the expanded catalog contract and localized rendering.
- [x] Assert resource names and metadata through Rust catalog tests.
- [x] Run frontend tests, Rust library tests, `cargo check`, and `cargo check --release`.
