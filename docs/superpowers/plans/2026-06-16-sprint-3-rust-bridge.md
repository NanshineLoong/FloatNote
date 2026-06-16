# Sprint 3 — Rust 中枢 + 协议接线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development / executing-plans。执行前展开为 bite-sized 步骤。依赖 Sprint 1（versions）与 Sprint 2（sidecar 协议）。

**Goal:** 让 Rust 后端拉起 agent-sidecar 子进程、按协议双向通信，把前端的"发消息"转发给 sidecar、把 sidecar 的流式事件经 Tauri 事件广播给所有助手视图；并把 `apply_write` 接到 Sprint 1 的快照库——AI 每次覆盖笔记自动留版本。本 sprint 用 devtools 调通全链路，UI 留到 Sprint 4。

**Architecture:** 新增 `agent.rs`：用 `std::process` 起 sidecar，单独线程读 stdout 按行解析协议，写 stdin 发命令；`AgentState`（放进 `AppState` 或独立 manage）持有子进程句柄、stdin、待写映射。Tauri 命令 `agent_send` / `agent_cancel` / `agent_configure`；Tauri 事件 `agent://event` 把协议消息转发给前端。`apply_write` 在 Rust 侧执行：`versions::snapshot(dir, note_id, 旧内容, "ai")` → 写新内容到笔记文件 → emit `note://updated` → 回 sidecar `apply_write_result`。

**Tech Stack:** Rust（std::process、std::thread、std::sync、serde_json、tauri events）。开发期 sidecar 用 `npx tsx`（打包到 Sprint 6）。

---

## 文件结构

- Create: `src-tauri/src/agent.rs` — sidecar 生命周期 + 协议 + 转发 + apply_write 处理
- Modify: `src-tauri/src/commands.rs` — `agent_send` / `agent_cancel` / `agent_configure` 命令；`AppState` 加 agent 句柄
- Modify: `src-tauri/src/lib.rs` — `mod agent;`、setup 里启动 sidecar、注册命令
- Create: `src/note/agent.ts` — 前端 invoke 封装 + `agent://event` 监听器类型（Sprint 4 用）

---

## 协议（Rust 侧需与 Sprint 2 完全一致）

- 定义 `enum HostToSidecar { Configure{..}, Prompt{..}, ApplyWriteResult{..}, Cancel{..} }` 与 `enum SidecarToHost { Ready, Delta{..}, Tool{..}, ApplyWrite{..}, Done{..}, Error{..} }`，`#[serde(tag="type", rename_all="snake_case")]`，字段名与 Sprint 2 的 JSON 完全对齐（`requestId`→ 注意 JSON 用 camelCase，Rust 端用 `#[serde(rename_all="camelCase")]`）。

---

## Task 1: sidecar 进程管理

- [ ] `agent.rs`：`struct AgentHandle { child: Child, stdin: ChildStdin }`，`fn spawn(app: AppHandle, sidecar_cmd: ...) -> io::Result<AgentHandle>`。开发期命令 = `npx tsx <repo>/sidecar/src/main.ts`（路径用 `tauri::path` resolver 或相对 dev 约定；Sprint 6 换成打包二进制）。
- [ ] 起一个线程读 `child.stdout`，按行 `serde_json::from_str::<SidecarToHost>` 解析，分派到 handler。
- [ ] 单测：协议 enum 的 serde 往返（`Delta`/`ApplyWrite`/`Prompt` 等 JSON ↔ 结构体），不依赖真实子进程。
- [ ] 提交：`feat(agent): sidecar process spawn + protocol types`。

## Task 2: 转发 sidecar→前端事件

- [ ] stdout handler：对 `Delta/Tool/Done/Error` 直接 `app.emit("agent://event", msg)`。
- [ ] `Ready` → 标记 agent 就绪（存 state，供 UI 查询/显示）。
- [ ] 提交：`feat(agent): relay sidecar stream to tauri events`。

## Task 3: apply_write → 快照 + 写盘

- [ ] handler 收到 `ApplyWrite{callId, noteId, content}`：
  - 由 noteId 解析出 `dir` 与 `path`（当前活动笔记信息从 state 取——`agent_send` 时一并存入 state：`{dir, path, noteId}`）。
  - 读旧内容 → `versions::snapshot(dir, noteId, 旧内容, "ai")` 得 `version`。
  - `std::fs::write(path, content)`。
  - `app.emit("note://updated", { noteId, path, version })`。
  - 经 stdin 回 `ApplyWriteResult{callId, ok:true, version}`；任一步失败回 `ok:false, error`。
- [ ] 单测：把"快照+写盘"抽成纯函数 `apply_write(dir, note_id, path, new_content) -> Result<u32>` 并测（旧内容被留版本、文件被改写）。
- [ ] 提交：`feat(agent): apply_write snapshots old content then overwrites`。

## Task 4: 命令 agent_send / cancel / configure

- [ ] `commands.rs`：
  - `agent_configure(state, provider, model, api_key)` → 经 stdin 发 `Configure`。
  - `agent_send(state, dir, note_id, path, note_text, user_text)` → 存活动笔记到 state、发 `Prompt{requestId,...}`，返回 `requestId`。
  - `agent_cancel(state, request_id)` → 发 `Cancel`。
- [ ] `AppState` 增加 `agent: Mutex<Option<AgentHandle>>` 与 `active_note: Mutex<Option<ActiveNote>>`。
- [ ] `lib.rs` setup：spawn sidecar 并存入 state（失败仅 `eprintln!`，不阻断启动）；注册三个命令。
- [ ] `cargo test` 全绿；`cargo check` 通过。
- [ ] 提交：`feat(agent): agent_send/cancel/configure commands`。

## Task 5: 前端封装 + 全链路手验

- [ ] `src/note/agent.ts`：`agentConfigure/agentSend/agentCancel` invoke 封装；`onAgentEvent(cb)` 用 `listen("agent://event")`；`onNoteUpdated(cb)` 用 `listen("note://updated")`。导出事件 payload TS 类型（与协议对齐）。
- [ ] 手动（dev）：`npm run tauri dev`（确保 `sidecar` 已 `npm install`）。在笔记窗 devtools 控制台：`__TAURI__.core.invoke('agent_configure',{provider:'anthropic',model:'...',apiKey:'...'})` 后 `agent_send(...)`，观察 `agent://event` 流；触发改写时编辑器对应文件被覆盖且 `list_versions` 多一条 `source:"ai"`。
- [ ] 提交：`feat(agent): frontend bindings + verified end-to-end via devtools`。

---

## 验收清单（Sprint 3 Done）

- [ ] `cd src-tauri && cargo test` 全绿（协议往返 + apply_write 纯函数测试）
- [ ] dev 下：发 prompt 能在 `agent://event` 收到流式 delta
- [ ] AI 改写：笔记文件被覆盖 + `.floatnote/versions` 新增 `source:"ai"` 版本 + 收到 `note://updated`
- [ ] sidecar 崩溃时 Rust 不 panic（标记不可用、发 error 事件）
- [ ] 协议字段 Rust↔Node 完全一致（camelCase JSON）

## 给 Sprint 4 的接口约定

- 前端通过 `agentSend({dir, noteId, path, noteText, userText})` 发消息；订阅 `onAgentEvent` 渲染对话；订阅 `onNoteUpdated` 热刷新编辑器与版本条。
