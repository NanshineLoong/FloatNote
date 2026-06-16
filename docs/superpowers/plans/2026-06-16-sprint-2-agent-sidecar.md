# Sprint 2 — Node agent-sidecar + Pi 接入 Implementation Plan

**Goal:** 写一个独立的 Node 程序 `agent-sidecar`，内部用 Pi SDK 跑一个 tutor 会话：从 stdin 收行分隔 JSON（prompt + 当前笔记全文），把流式回复和工具调用以行分隔 JSON 写回 stdout；提供 `read_note` / `write_note` 两个自定义工具（写盘动作委托给宿主，不直接落盘）。本 sprint 让它能用 CLI 独立跑通，不依赖 Tauri。

**Architecture:** 独立 npm 子包 `sidecar/`（自带 package.json，便于单独打包）。一个 `Protocol` 层负责 stdio JSONL 编解码；一个 `agent.ts` 用 `createAgentSession` + `defineTool` + `DefaultResourceLoader` 组装会话；`write_note` 工具通过协议向宿主发 `apply_write` 请求并 await 宿主回执（本 sprint 用一个 mock 宿主 harness 验证）。provider/model/key 从启动参数/env 读。

**Tech Stack:** Node.js + TypeScript、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`typebox`、`tsx`（dev 运行）、`vitest`（单测）。

---

## ⚠️ 执行前置（必做）

用 Context7 确认以下 Pi API 的真实签名与字段（训练记忆可能过时）：
- `createAgentSession` 的入参（`customTools` / `tools` / `model` / `resourceLoader` / `sessionManager` / `authStorage` / `modelRegistry` 等）。
- `session.subscribe` 事件类型枚举与字段（`message_update` → `assistantMessageEvent.type==="text_delta"` 的 `delta`；`tool_execution_start/end`；`agent_end`）。
- `defineTool` 的 `execute(toolCallId, params)` 返回结构（`{ content: [{type:"text",text}], details }`）。
- `DefaultResourceLoader({ systemPromptOverride })` + `reload()`。
- `getModel(provider, model)` 支持的 provider 列表与 key 解析方式。

把确认结果记到本文件"API 核对"小节后再写代码。

---

## 文件结构

- Create: `sidecar/package.json` — 子包，含 `@earendil-works/pi-coding-agent` 等依赖与 build/test 脚本
- Create: `sidecar/tsconfig.json`
- Create: `sidecar/src/protocol.ts` — JSONL 编解码 + 消息类型定义（与 Sprint 3 Rust 端对齐）
- Create: `sidecar/src/protocol.test.ts`
- Create: `sidecar/src/tutor-prompt.ts` — tutor 系统提示词常量
- Create: `sidecar/src/note-tools.ts` — `read_note` / `write_note` 的 `defineTool`，写动作走协议委托
- Create: `sidecar/src/agent.ts` — 组装 session、订阅事件→协议输出
- Create: `sidecar/src/main.ts` — 入口：读 env/argv 配置，连 stdin/stdout，跑 agent
- Create: `sidecar/test/harness.ts` — mock 宿主：喂一条 prompt、打印事件、自动回 `apply_write` ok

---

## 协议（与 Sprint 3 Rust 端共享契约）

行分隔 JSON。每行一个对象，含 `type` 字段。

**宿主 → sidecar：**
- `{ "type": "configure", "provider": "anthropic", "model": "claude-opus-4-8", "apiKey": "..." }`
- `{ "type": "prompt", "requestId": "r1", "noteId": "我的笔记", "noteText": "<全文>", "userText": "..." }`
- `{ "type": "apply_write_result", "callId": "c1", "ok": true, "version": 7 }`（或 `ok:false, error`）
- `{ "type": "cancel", "requestId": "r1" }`

**sidecar → 宿主：**
- `{ "type": "ready" }`
- `{ "type": "delta", "requestId": "r1", "text": "..." }`
- `{ "type": "tool", "requestId": "r1", "name": "write_note", "phase": "start|end" }`
- `{ "type": "apply_write", "callId": "c1", "noteId": "我的笔记", "content": "<新全文>" }`
- `{ "type": "done", "requestId": "r1" }`
- `{ "type": "error", "requestId": "r1|null", "message": "..." }`

---

## Task 1: 子包脚手架

- [ ] `sidecar/package.json`：`"type":"module"`；deps：`@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`typebox`；devDeps：`typescript`、`tsx`、`vitest`、`@types/node`。scripts：`"dev":"tsx src/main.ts"`、`"test":"vitest run"`、`"build":"tsc"`。
- [ ] `sidecar/tsconfig.json`：`module:"ESNext"`, `moduleResolution:"Bundler"`, `target:"ES2022"`, `strict:true`, `outDir:"dist"`。
- [ ] `cd sidecar && npm install`，确认 Pi 包安装成功（记下实际版本号到"API 核对"）。
- [ ] 提交：`chore(sidecar): scaffold node sub-package`。

## Task 2: 协议编解码（TDD）

- [ ] `protocol.test.ts`：测 `encodeLine(obj)` 产出以 `\n` 结尾的单行 JSON；`createLineDecoder()` 能把分段 chunk 累积、按 `\n` 切出完整对象、忽略空行、保留半行缓冲。给出至少 3 个用例（完整行、跨 chunk 半行、多行一次到达）。
- [ ] 跑测试失败 → 实现 `protocol.ts`（`HostToSidecar` / `SidecarToHost` 联合类型 + `encodeLine` + `createLineDecoder`）→ 跑测试通过。
- [ ] 提交：`feat(sidecar): jsonl protocol codec`。

## Task 3: tutor 提示词

- [ ] `tutor-prompt.ts` 导出 `TUTOR_SYSTEM_PROMPT` 常量：苏格拉底式提问、拆解步骤、给建设性反馈、引导下一步而非直接给答案；说明它能用 `read_note` 读当前笔记、用 `write_note` 整理/重写笔记（会被自动留版本）；要求中文回应；强调改写前应解释意图。
- [ ] 提交：`feat(sidecar): tutor system prompt`。

## Task 4: 笔记工具（委托写盘）

- [ ] `note-tools.ts`：`createNoteTools({ getNoteText, requestWrite })` 返回 `read_note`、`write_note` 两个 `defineTool`：
  - `read_note`（无参或 `{}`）：`execute` 返回当前 `getNoteText()` 文本。
  - `write_note`（params `{ content: string }`）：`execute` 调 `await requestWrite(content)`（向宿主发 `apply_write` 并等回执），成功返回 `{content:[{type:"text",text:"已更新笔记，版本 vN"}],details:{}}`，失败返回错误文本。
  - `requestWrite` 由 `agent.ts` 注入：生成 `callId`、发 `apply_write`、在一个 `Map<callId, resolver>` 里挂起 Promise，收到 `apply_write_result` 时 resolve。
- [ ] 单测：用 fake `requestWrite` 验证 `write_note.execute` 透传 content 并按回执返回成功/失败文本。
- [ ] 提交：`feat(sidecar): note read/write tools with host-delegated writes`。

## Task 5: 会话组装 + 事件转协议

- [ ] `agent.ts`：`class AgentRunner`，持有 `send(line)` 回调与待写 Map：
  - `configure(cfg)`：用 `getModel(cfg.provider, cfg.model)` + key 建 `createAgentSession`，`customTools: noteTools`，`tools: ["read_note","write_note"]`（**不含** bash/内置 fs），`resourceLoader` 注入 tutor 提示词。
  - `prompt({requestId,noteText,userText})`：设置当前 noteText（供 `read_note`）、`session.subscribe` 把 `text_delta`→`delta`、`tool_*`→`tool`、`agent_end`→`done` 转协议输出；`await session.prompt(userText)`。
  - `onApplyWriteResult(msg)`：resolve 对应挂起写请求。
- [ ] 单测（mock session 或注入式）：喂一段假事件流，断言输出协议序列正确（delta… → done）。
- [ ] 提交：`feat(sidecar): agent runner streaming pi events to protocol`。

## Task 6: 入口 + mock harness 跑通

- [ ] `main.ts`：从 `process.argv`/env 读初始配置（`PI_PROVIDER`/`PI_MODEL`/`ANTHROPIC_API_KEY` 等）；接 `process.stdin` 经 decoder 喂 `AgentRunner`，`send` 写 `process.stdout`；启动后输出 `{type:"ready"}`。
- [ ] `test/harness.ts`：spawn `tsx src/main.ts`，发一条 `configure` + 一条 `prompt`（含一段笔记文本和"帮我把这段整理成要点并改写笔记"），打印所有 stdout 行，遇 `apply_write` 自动回 `{type:"apply_write_result",ok:true,version:1}`。
- [ ] 手动（需有效 key）：`ANTHROPIC_API_KEY=... npx tsx test/harness.ts`，观察：有 `delta` 流、可能有 `tool write_note start/end` 与 `apply_write`、最后 `done`。
- [ ] 提交：`feat(sidecar): entrypoint + manual harness`。

---

## 验收清单（Sprint 2 Done）

- [ ] `cd sidecar && npm test` 全绿（protocol / note-tools / agent runner）
- [ ] `npm run build`（sidecar）通过
- [ ] harness 跑通：能流式收到 tutor 回复；触发改写时能收到 `apply_write` 并在回执后继续
- [ ] sidecar **不**使用任何网络端口、不直接写笔记文件（写动作只发 `apply_write`）
- [ ] "API 核对"小节已据 Context7 填写实际签名

## API 核对（执行时填写）

- Pi 包版本：`TODO 执行时填`
- createAgentSession 实际入参：`TODO`
- 事件字段实测：`TODO`
- provider/model 标识符：`TODO`
