# Sprint 5 — 设置页多 provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development / executing-plans。执行前展开为 bite-sized 步骤。依赖 Sprint 3（`agent_configure`）。

**Goal:** 在设置页让用户选择 AI provider（Anthropic / OpenAI 等 Pi 支持的）、为每个 provider 填 API key、选择具体 model；保存后热应用到 sidecar（重新 `agent_configure`）。key 持久化到用户配置，不进 git。

**Architecture:** 扩展 `config.rs` 的 `Config` 增加 agent 相关字段（当前 provider、model、各 provider 的 key map）。设置页新增"AI 助手"分区：provider 下拉 → 联动 model 下拉 → key 输入。保存走现有 `set_config`，再调 `agent_configure` 推给 sidecar。provider/model 清单作为前端常量（执行时按 Pi 实际支持核对）。

**Tech Stack:** Rust（serde Config）、TypeScript（设置页 `src/settings/`）。

---

## 文件结构

- Modify: `src-tauri/src/config.rs` — `Config` 加 `agent_provider: String`、`agent_model: String`、`agent_keys: HashMap<String,String>`；`#[serde(default)]` 保证旧配置兼容；更新现有测试
- Modify: `src/note/notes-state.ts:8-14` — `Config` TS 接口同步加字段
- Create: `src/settings/agent-config.ts` — provider/model 常量表 + 纯校验/联动逻辑
- Create: `src/settings/agent-config.test.ts` — 联动/校验单测
- Modify: `src/settings/main.ts` — 渲染"AI 助手"分区、保存接线、保存后 `agent_configure`
- Modify: `settings.html` / 设置样式 — 视情况

---

## Task 1: Config 扩展（TDD）

- [ ] `config.rs`：`Config` 加：
  ```rust
  pub agent_provider: String,          // 默认 "anthropic"
  pub agent_model: String,             // 默认最新 Claude，例 "claude-opus-4-8"
  pub agent_keys: std::collections::HashMap<String, String>, // provider -> key，默认空
  ```
  `Default` 与现有保持风格；`#[serde(default)]` 已在结构体级别。
- [ ] 加测试：`partial_json_keeps_other_defaults` 风格——只给 `{"agent_provider":"openai"}` 时其它字段仍是默认；roundtrip 含 keys map。
- [ ] `cargo test config::` 通过。
- [ ] 提交：`feat(config): agent provider/model/keys fields`。

## Task 2: 前端 provider/model 常量 + 校验（TDD）

- [ ] `agent-config.ts`：`PROVIDERS = [{ id:"anthropic", label:"Anthropic", models:[...] }, { id:"openai", label:"OpenAI", models:[...] }]`（model 列表执行时按 Pi 实际支持核对，并在注释标注来源）。
- [ ] 纯函数：`modelsFor(providerId)`、`isConfigValid({provider,model,key})`（key 非空、model 属于该 provider）。
- [ ] `agent-config.test.ts`：测换 provider 后 model 选项联动、校验逻辑。
- [ ] 实现 → 测试通过。
- [ ] 提交：`feat(settings): provider/model catalog + validation`。

## Task 3: 设置页 UI + 保存接线

- [ ] `settings/main.ts`：新增"AI 助手"分区：provider 下拉（变更联动 model 下拉）、model 下拉、当前 provider 的 key 输入（password 型，显示"已配置"占位而不回显明文）。
- [ ] 读取：`get_config` 填充当前值；切 provider 时显示对应已存 key 状态。
- [ ] 保存：写回 `agent_provider/agent_model/agent_keys`（合并而非覆盖整个 map）→ `set_config` → 调 `agent_configure({provider, model, apiKey})` 把新配置推给 sidecar。
- [ ] 校验失败（缺 key）时禁用保存并给提示。
- [ ] 提交：`feat(settings): AI assistant section wired to agent_configure`。

## Task 4: 启动时应用配置

- [ ] `lib.rs` setup：sidecar spawn 后，若 `config.agent_keys` 含当前 provider 的 key，则自动发一次 `Configure`，使助手开箱即用。
- [ ] 缺 key 时：助手 UI（Sprint 4）显示"请在设置中配置 API Key"。
- [ ] 提交：`feat(agent): auto-configure sidecar from saved config on startup`。

---

## 验收清单（Sprint 5 Done）

- [ ] `cargo test` / `npm test` / `npm run build` 全绿
- [ ] 设置页可选 provider、联动 model、填 key 并保存
- [ ] 保存后无需重启即可对话（热配置生效）
- [ ] key 存于用户配置目录、未进 git；明文不回显
- [ ] 旧 `config.json`（无 agent 字段）能正常加载（serde default）
- [ ] provider/model 清单已按 Pi 实际支持核对
