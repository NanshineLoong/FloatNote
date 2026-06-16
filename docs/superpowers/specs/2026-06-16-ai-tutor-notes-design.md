# AI Tutor 笔记 — 设计文档

日期：2026-06-16
状态：已与用户确认，待进入实现计划（writing-plans）

## 1. 目标

把 FloatNote 从纯笔记应用，演进为"AI 引导式笔记"应用：主体仍是一个浮动笔记窗口，旁边是一个 AI 助手。助手像 tutor 一样工作——接收用户记录、给反馈、向用户提问、回答用户问题，并能**直接覆盖**用户的笔记内容；笔记通过**版本管理**在不同版本间切换。

## 2. 已确定的设计前提（用户拍板）

- **窗口形态**：助手可吸附/折叠。默认是贴在笔记窗右侧的**独立窗口（分离模式）**；笔记窗右上角有胶囊/图标按钮可折叠或切换模式。**全屏 / 进入独立 Space 时自动强制切为嵌入模式**（笔记窗内右侧栏），退出全屏可切回；非全屏也允许手动切换分离/嵌入。
- **版本管理**：自建**轻量快照库**（非 git）。**AI 每次覆盖笔记时自动生成一个新版本**；用户可在版本间切换/回退。
- **后端 Agent 框架**：Pi（`@earendil-works/pi-coding-agent`，Node.js SDK）。
- **tutor 触发方式**：先做**纯被动**（仅用户主动发消息/点按钮时响应；不主动插话）。
- **AI 可见上下文**：当前这一篇笔记的全文 + 本次对话历史（暂不跨笔记检索）。
- **AI 改笔记方式**：**直接覆盖**当前笔记内容（不走 diff 确认）；因为每次覆盖前自动留版本，回退成本低。
- **模型 / Provider**：**多 provider 可选**（Anthropic / OpenAI 等 Pi 支持的），设置页各填 key、选具体 model；key 存用户配置，不进 git。

## 3. 关键技术决策：Pi 接入拓扑

Webview 无法运行 Node，所以 Pi 必须运行在一个独立的 Node 进程中。

采用方案：**自建薄 Node sidecar（内部调用 Pi SDK）+ stdio/Rust 中枢**。

- 编写一个小型 Node 程序 `agent-sidecar`：用 `createAgentSession` 起会话，`defineTool` 注册 `read_note`/`write_note`，`DefaultResourceLoader.systemPromptOverride` 注入 tutor 提示词，按设置 `getModel(provider, model)` 选模型。
- sidecar ↔ Rust：自定义的**行分隔 JSON（stdin/stdout）**协议。
- Rust ↔ 两个 webview 视图：Tauri **命令 + 事件**。
- **Rust 是唯一的状态源与文件写入方**：会话编排、快照版本库、笔记写盘都归 Rust 管。助手的分离窗口与嵌入栏都只是"订阅 Tauri 事件的视图"。
- 不开任何网络端口（不采用 localhost WebSocket 方案）。
- `write_note` 工具不自己写盘，而是回调 Rust 执行"快照旧版 → 写新内容 → 广播更新"，保证版本与文件一致。

被否决的替代方案：
- **Pi RPC 模式直连**：自定义工具 / tutor 提示词是 SDK 能力，RPC 模式下不一定能注册，控制力弱。
- **localhost WebSocket 前端直连**：需开端口、Rust 不再是状态源、两界面各连各的、版本/文件逻辑分散。

## 4. 总体架构

```
笔记窗 (index.html, webview "main")
  ├─ 笔记编辑区 (CodeMirror) + 顶栏 + 版本条
  └─ 助手栏（嵌入模式时挂载，= assistant 视图）
独立助手窗 (assistant.html, webview "assistant", 分离模式)
        │  Tauri 命令/事件
Rust 后端（中枢/唯一状态源）
   • 会话编排  • 快照版本库  • 笔记文件读写  • sidecar 生命周期
        │  行分隔 JSON over stdin/stdout
Node agent-sidecar (Pi SDK)
   createAgentSession · defineTool(read_note/write_note)
   · DefaultResourceLoader(tutor 提示词) · getModel(provider, model)
```

- 助手 UI 是**一份代码**，既能作为独立窗口 `assistant.html`（webview "assistant"），也能作为笔记窗内右侧栏挂载。两者都通过 Tauri 命令发消息、订阅同一组事件。
- 新增 Rust 模块：`agent.rs`（sidecar 管理 + 协议）、`versions.rs`（快照库）。复用现有 `windows.rs`、`commands.rs`、`config.rs`、`notes.rs`。
- 新增 Vite 入口 `assistant.html` + `src/assistant/`（助手 UI 模块）。

## 5. 版本快照库（`versions.rs`）

目录布局（与笔记同根，隐藏目录，不进 git）：

```
<notes_dir>/
  我的笔记.md                       ← 当前内容（始终是最新版）
  .floatnote/versions/<note-id>/
      manifest.json                ← [{ v, ts, source: "ai"|"manual", summary? }]
      v1.md  v2.md  v3.md …         ← 每版全文快照
```

- `note-id`：对文件名做稳定哈希，重命名不丢历史；manifest 内同时记录当前文件名。
- 触发：**AI 每次 `write_note` 成功覆盖前**，先将"即将被覆盖的旧内容"存为一版，再写新内容。
- Tauri 命令：
  - `list_versions(noteId)` → manifest 列表
  - `get_version(noteId, v)` → 某版全文
  - `restore_version(noteId, v)` → 把该版内容写回当前文件；恢复前先把"当前内容"再留一版作为安全点
- 采用**全文快照**而非 diff：实现简单可靠，单篇笔记体量小，不引入 diff 引擎（YAGNI）。

## 6. 数据流（一次对话 + AI 改笔记）

1. 用户在助手里发消息 → webview 调 `agent_send({ noteId, text })`。
2. Rust 把"当前笔记全文 + 这条消息"打包，经 stdio 发给 sidecar。
3. sidecar `session.prompt(...)`，把 Pi 流式事件（`text_delta` / `tool_execution_start|end` / `agent_end`）转成我们的 JSON 行回传 Rust。
4. Rust 通过 Tauri 事件 `agent://event` 广播 → 所有挂载的助手视图实时渲染。
5. 若模型调 `write_note`：sidecar 发 `apply_write` 请求给 Rust → Rust 执行**快照旧版 → 写新内容 → 发 `note://updated` 事件** → 编辑器热更新 + 版本条出现 "vN" → Rust 回 sidecar "ok"，对话继续。

协议（行分隔 JSON）需覆盖的消息类型（初稿，实现时细化）：
- Rust→sidecar：`prompt`（含 noteId、note 全文、用户文本）、`cancel`、`configure`（provider/model/key）、`apply_write_result`。
- sidecar→Rust：`event`（text_delta / tool / agent_end）、`apply_write`（请求写笔记）、`error`、`ready`。

## 7. 窗口与模式行为

- **分离模式（默认，非全屏）**：assistant 窗紧贴 main 右缘；监听 main 的 move/resize 令 assistant 跟随吸附。
- **折叠**：main 右上角胶囊按钮 → 隐藏/显示 assistant 窗。
- **嵌入模式**：assistant 窗隐藏，笔记窗内右侧栏挂载同一份助手 UI。
- **全屏自动切换**：监听 main 的全屏/Space 变化 → 进入全屏强制 embedded、退出可回 detached；胶囊按钮在非全屏也能手动切。
- 模式状态存 `config.rs`，启动恢复。
- 视觉参考用户提供的 `docs/refer_frontend.png`（右侧聊天气泡式助手 + 左侧笔记卡片 + 版本条）。

## 8. Agent / tutor 配置

- **tutor 系统提示词**（`systemPromptOverride`）：苏格拉底式提问、拆解步骤、给反馈、引导下一步，而非直接给答案；告知它拥有 `read_note`/`write_note` 工具且可整理用户笔记。提示词放可维护的常量文件。
- **工具**：仅 `read_note`、`write_note`（禁用 Pi 自带 bash / 文件系统工具，安全且聚焦）。
- **多 provider**：设置页选 Anthropic / OpenAI（等 Pi 支持的），各填 key、选 model；存用户配置，不进 git。sidecar 启动按配置 `getModel(provider, model)`。
- 改 provider/model/key → Rust 重启或热配置 sidecar。

## 9. 错误处理

- **sidecar 崩溃/退出**：Rust 监控子进程，退出则标记会话不可用并发错误事件，助手 UI 显示"助手已断开，点击重连"，支持重启。
- **缺 key / 鉴权失败**：sidecar 回结构化错误 → UI 提示去设置页填 key。
- **写入失败 / 版本库损坏**：`apply_write` 失败回滚，不破坏当前笔记；manifest 读写做容错。

## 10. 测试

- 前端 Vitest：协议消息解析、版本条状态机、模式切换逻辑（纯函数 / 状态部分）。
- Rust `cargo test`：`versions.rs` 快照/恢复/重命名保历史（仿现有 `notes.rs` 测试风格）。
- sidecar：`read_note`/`write_note` 工具与协议编解码的轻量单测。
- 手动 `npm run tauri dev` 跑通全链路。

## 11. 打包 / 跨平台

- sidecar 需要 Node 运行时。计划中作为独立任务处理：用 Node SEA 或 `bun build --compile` 把 sidecar 打成单可执行文件，作为 **Tauri sidecar** 随应用分发（Windows + macOS 双目标）。
- 全屏/Space、窗口吸附等平台敏感行为按 AGENTS.md 要求在两端验证。

## 12. 暂不做（YAGNI / 后续）

- 半主动 / 强主动 tutor（停笔自动引导）——先纯被动，预留开关位。
- 跨笔记检索 / RAG。
- diff 式版本对比 UI（先做版本列表 + 切换/回退）。
- AI 改笔记前的 diff 确认流程。

## 13. Sprint 4 助手 UI 决策（2026-06-16 补充，已与用户确认）

在进入 Sprint 4 实现前，对助手 UI 的视觉与交互做了如下细化（取代 §7 末尾对 `refer_frontend.png` 的笼统引用）：

- **气泡配色**：AI 气泡为**纯白**（白底 + 0.5px 细边、左对齐、左下角小尖角）；用户气泡为**单一浅蓝色调**（右对齐，明显区别于白，但不花哨）。不使用参考图里的多彩气泡。
- **机器人形象**：助手底部常驻 `docs/robot.svg`（悬浮机器人）作为头像/触发点；笔记窗顶栏的打开按钮用 `docs/robot_icon.svg`。
- **输入框「按需展开」交互（取代常驻输入框）**：
  - 默认状态下，助手底部 dock 只有机器人头像，**输入框不存在**。
  - 点击机器人 → 输入框从机器人**右侧水平展开**（`max-width` 0→满 + 淡入 + 轻微位移，约 340ms ease-out 缓动），机器人同时做一次轻微缩放「应答」；再次点击收起。输入框停在机器人旁边，不从屏幕边缘飞入。
- **两个入口分工**：顶栏 `robot_icon` 负责**开/关整个助手**（分离窗口或嵌入栏）；助手内的 `robot.svg` 头像负责**展开/收起输入框**。
- **窗口模式**：Sprint 4 一次性实现完整双模式（默认分离吸附窗 + 嵌入栏 + 胶囊切换 + 全屏自动嵌入），与 §7 一致。
