# AI Provider Settings Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic AI connection editor with six fixed provider profiles, atomic activation, provider-aware Pi model resolution, and automatic thinking defaults.

**Architecture:** A pure frontend provider-settings module owns provider metadata, draft normalization, validation, and render state. Rust owns the persisted `AiSettings` aggregate and the transactional save/activate commands; the JSONL configure request gains a correlated result so persistence happens only after the sidecar accepts a candidate. The sidecar resolves each fixed profile to a Pi-native model or a provider-specific fallback and derives the runtime thinking level from model metadata.

**Tech Stack:** Vanilla TypeScript, Vitest/jsdom, Tauri 2, Rust/Serde/Tokio, Node JSONL sidecar, `@earendil-works/pi-ai` 0.80.6.

## Global Constraints

- Keep exactly this provider order: OpenAI API, DeepSeek API, Anthropic API, 阿里云百炼 API, Kimi API, 智谱 API.
- At most one provider is active; `null` means AI is disabled.
- Models start empty and are always free-text user input.
- Base URL is editable only for OpenAI, Anthropic, and Bailian; built-in official URLs apply when empty.
- Do not read or migrate legacy AI fields.
- Preserve macOS and Windows path/line-ending portability.
- Never include API keys, authorization headers, or credential-bearing URLs in logs or visible errors.

---

### Task 1: Fixed frontend provider model and validation

**Files:**
- Replace: `src/settings/provider-profiles.ts`
- Replace: `src/settings/provider-profiles.test.ts`

**Interfaces:**
- Produces: `AiProviderId`, `AiProviderConfig`, `AiSettings`, `PROVIDER_PROFILES`, `createEmptyAiSettings()`, `isProviderConfigured()`, and `validateProviderDraft()`.

- [ ] Write tests asserting the six IDs/order, empty defaults, Base URL eligibility, trimming, trailing-slash normalization, and field-specific failures.
- [ ] Run `npm run test:frontend -- src/settings/provider-profiles.test.ts`; expect failures against the legacy profiles.
- [ ] Implement the fixed metadata and pure validation helpers with `new URL()` plus an explicit `http:`/`https:` protocol check.
- [ ] Re-run the focused test; expect all assertions to pass.

### Task 2: Rust persisted aggregate

**Files:**
- Modify: `src-tauri/src/config.rs`

**Interfaces:**
- Produces: `AiProviderId`, `AiProviderConfig`, `AiSettings::default()`, `AiSettings::configured_profile()`, and `Config.ai_settings`.

- [ ] Replace the legacy migration test with tests proving six empty profiles, `active_provider_id: None`, legacy JSON fields are ignored, Base URL is rejected for ineligible providers, and camelCase serialization round-trips.
- [ ] Run `cargo test --lib config::tests` from `src-tauri`; expect the new tests to fail.
- [ ] Implement the new types and remove `AiConnection`, `AiCustomModel`, `AiModelSelection`, legacy `Config` fields, and migration helpers.
- [ ] Re-run the focused Rust tests; expect pass.

### Task 3: Correlated sidecar configuration

**Files:**
- Modify: `sidecar/src/protocol.ts`
- Modify: `sidecar/src/protocol.test.ts`
- Modify: `sidecar/src/main.ts`
- Modify: `src-tauri/src/agent/protocol.rs`
- Modify: `src-tauri/src/state.rs`
- Modify: `src-tauri/src/agent/runner.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/agent/handlers.rs`

**Interfaces:**
- `configure` consumes `{ callId, provider, model, apiKey, baseUrl? }`.
- `configure_result` produces `{ callId, ok, error? }` with sanitized errors.

- [ ] Add TypeScript and Rust protocol round-trip tests for success and failure results.
- [ ] Run the focused sidecar protocol and Rust protocol tests; expect missing variants/fields.
- [ ] Add the correlated response, a `pending_agent_configs` oneshot map, timeout cleanup, and reader resolution.
- [ ] Re-run focused tests; expect pass.

### Task 4: Provider-aware model resolution and automatic thinking

**Files:**
- Replace: `sidecar/src/model.ts`
- Replace: `sidecar/src/model.test.ts`
- Modify: `sidecar/src/runner.ts`
- Modify: `sidecar/src/agent.test.ts`
- Remove: `sidecar/src/model-config.ts`
- Remove: `sidecar/src/model-config.test.ts`

**Interfaces:**
- Produces: `buildAgentModel(config): Model<Api>` and `resolveAgentConfig(config): ResolvedAgentConfig`.
- Fixed runtime mappings: `openai`, `deepseek`, `anthropic`, `bailian`, `moonshotai-cn`, and `zhipu` with Z.AI metadata reuse.

- [ ] Add tests for native metadata reuse, provider-specific fallback metadata, official/custom APIs, official Base URLs, and known/unknown reasoning behavior.
- [ ] Run focused model tests; expect failures against generic custom-connection behavior.
- [ ] Implement fixed provider descriptors, 128K/16K fallbacks, OpenAI custom Chat Completions, Anthropic custom Messages, Bailian Chat Completions, Kimi native mapping, and Zhipu metadata cloning with the China endpoint.
- [ ] Make `AgentRunner.configure()` validate before mutating its current config and choose `high` only for reasoning-capable models.
- [ ] Re-run model and runner tests; expect pass.

### Task 5: Transactional Rust provider commands

**Files:**
- Modify: `src-tauri/src/commands/settings.rs`
- Modify: `src-tauri/src/commands/agent.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/agent/runner.rs`

**Interfaces:**
- Produces commands `save_ai_provider(providerId, providerConfig)` and `set_active_ai_provider(providerId: Option<AiProviderId>)`.

- [ ] Add pure transaction tests proving inactive save persists directly, active save configures first, failed configure preserves old config, activation is mutually exclusive, and deactivation sends no configure.
- [ ] Run focused Rust tests; expect missing commands/domain helpers.
- [ ] Implement candidate validation, correlated sidecar configure, persistence-after-acceptance, rollback on persistence failure, and an `agent_send` guard when no provider is active.
- [ ] Re-run focused Rust tests; expect pass.

### Task 6: Inline-expand provider settings UI

**Files:**
- Create: `src/settings/provider-settings.ts`
- Create: `src/settings/provider-settings.test.ts`
- Modify: `src/settings/main.ts`
- Modify: `src/settings/styles.css`

**Interfaces:**
- Produces: `mountProviderSettings(root, settings, actions)` with save/activate callbacks.

- [ ] Add jsdom tests for six rows, statuses, one expanded row, text inputs, conditional Base URL, draft dirty/valid states, disabled unconfigured switches, mutual activation, and failed activation rollback.
- [ ] Run `npm run test:frontend -- src/settings/provider-settings.test.ts`; expect module-not-found failure.
- [ ] Implement semantic row buttons, checkbox switches, labeled fields, inline errors, saving feedback, retained saved-key state, and a single-column responsive layout using existing semantic design tokens.
- [ ] Integrate the mount into `main.ts`, remove the generic connection editor, and keep Skills independent.
- [ ] Re-run focused frontend tests; expect pass.

### Task 7: Documentation and full verification

**Files:**
- Modify: `docs/architecture/frontend.md`
- Modify: `docs/architecture/backend.md`
- Modify: `docs/architecture/sidecar.md`
- Modify: `docs/architecture/data-flow.md`
- Modify: `src-tauri/src/AGENTS.md`
- Modify: `sidecar/AGENTS.md`

- [ ] Document fixed profiles, transactional commands, correlated JSONL configuration, provider-specific fallback resolution, and automatic thinking.
- [ ] Run `npm test`, `npm run build`, and `npm run smoke:sidecar` from the repository root.
- [ ] Run `cargo fmt --check`, `cargo test --lib`, `cargo check`, and `cargo check --release` from `src-tauri/`.
- [ ] Inspect the settings window at narrow width, keyboard-only, light theme, dark theme, and reduced motion; capture any platform limitation in the handoff.
