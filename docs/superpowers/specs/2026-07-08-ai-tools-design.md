# AI Tools 设计

- 日期：2026-07-08
- 范围：sidecar（Pi SDK）暴露给 tutor 的工具集、写操作的权限气泡、版本与写入模式
- 状态：待评审

## 背景与现状

当前 sidecar 用 `createAgentSession` 拉起 Pi 会话，`noTools: "builtin"` 屏蔽内置工具，只注册两个自定义工具：

- `read_note`：返回当前笔记全文。
- `write_note`：把整篇新内容发给 Rust，Rust **先快照旧版→再整篇覆盖→广播 `note://updated`**（`src-tauri/src/agent.rs::apply_write`）。

写操作**委托**给 Rust：sidecar 不碰文件系统，Rust 是唯一状态源。标签系统在前端 `src/note/tags/model.ts`（纯逻辑，标签以 HTML 注释编码进 `_inbox.md`），任务在 `src/note/tasks.ts`（`- [ ]` 清单），版本在 `src-tauri/src/versions.rs`（仅对 `note_id` 不以 `_` 开头的文件快照，即 piece 与散文档；`_inbox`/`_tasks` 返回 0 不快照）。

本设计扩展工具集、引入写权限气泡、并明确版本与写入模式。

## 设计原则（调研所得）

1. **最小权限 / 最小作用域**（OWASP LLM06 Excessive Agency）。
2. **结构化操作优先于自由文本覆写**，但只在抽象真正付代价时抽象——主流 agent（Claude Code、Pi SDK 内置、Cursor）的通用编辑都是 `Read + Edit(str_replace) + Write(覆写)` 三件套，不拆 `insert_block`/`delete_block`（它们是 Edit 的特例）。
3. **风险分层审批**：v1 采用"凡写必确认"，演进路径见第 5 节。
4. **写操作委托给唯一状态源**：sidecar 不碰文件系统，Rust 负责落盘，天然支持回退与并发校验。
5. **一个工具一个原子事务**：标签操作复用 `tags/model.ts` 现有"一次 dispatch = 一次 undo"的事务。

## 1. 工具清单（7 个）

按"读 / 通用写 / 标签领域写"组织。所有写工具都经气泡确认（第 3 节），走同一条 `apply_edit` 路径（第 4 节）。

### 读类（自动放行）

| 工具 | 入参 | 语义 |
|---|---|---|
| `read_note` | `{ target? }` | 返回目标笔记全文（原始文本，含标签注释）。`target` 缺省=当前活动笔记。 |
| `list_tags` | `{ target? }` | 仅对 `_inbox` 有效。返回 `{ tags: [{id,name,color}], freeColors: [...] }`。`freeColors` 是 host 侧算出的可用颜色，供 `tag_create` 选色。 |

> **砍掉** `list_blocks`/`list_tasks`：`read_note` 已含全部信息，小笔记不必再分层读。`list_tags` 保留是因为"算出哪些颜色空闲"是 host 侧逻辑，AI 自减易错。

### 通用写类（气泡确认）

| 工具 | 入参 | 语义 |
|---|---|---|
| `edit_note` | `{ target?, old_string, new_string }` | 精确 str_replace，raw 文本匹配，唯一性校验。**一个工具覆盖**：块改写/插入/删除、任务增/勾/改/删。对齐 Claude Code 的 `Edit`。 |
| `write_note` | `{ target?, content }` | 整篇覆写兜底，少用、必确认。仅当结构化不便表达时用（大重构、跨多块改写）。 |

### 标签领域写类（气泡确认）

标签注释 `<!-- floatnote:tag=id -->` 是内部语法，AI 手写易错，故单独包一层；复用 `tags/model.ts` 现有事务逻辑。

| 工具 | 入参 | 语义 |
|---|---|---|
| `set_tag` | `{ anchor, tagId, target? }` | 给 anchor 定位的块打标签；`tagId=null` 清除。复用 `setBlockTagChange`。 |
| `tag_create` | `{ name, color, target? }` | 新建标签定义，`color` 必填且须为 `freeColors` 之一；占用则回当前 `freeColors`。复用 `addTagDefChange`。 |
| `tag_delete` | `{ tagId, target? }` | 删定义 + 清所有标记，复用 `deleteTagChanges`（一次事务，`edit_note` 做不到这个原子性）。 |

> **YAGNI**：`tag_rename`/`tag_recolor` 不做（用户手动改即可，AI 场景罕见）；`clear_tag` 不单列，合并进 `set_tag(tagId=null)`；任务不另立工具，走 `edit_note` 改 checkbox 文本（`- [ ] X` → `- [x] X`）。

### 抽象边界原则

只把"内部、非显而易见的语法"（标签注释）包成结构化工具；通用散文/清单编辑直接用 raw 文本的 `edit_note`，和所有其他 agent 一样。**不过度抽象，只在抽象真正付得出代价时抽象。**

### `target` 语义

所有带 `target?` 的工具，缺省=当前活动笔记。显式传时为 `{ kind: "inbox" | "tasks" | "piece" | "doc", name?: string }`：

- `inbox` / `tasks`：项目空间的 `_inbox.md` / `_tasks.md`，无需 `name`。
- `piece`：项目空间内的写作区文件，`name` 指定哪一篇（缺省=当前 piece）。
- `doc`：根目录散文档，`name` 指定文件名。

Rust 据 `kind`+`name`+当前项目空间解析出 `(dir, note_id, path)`。AI 可在用户看 `_inbox` 时给 `tasks` 加行动项（跨文件）。

## 2. 匹配算法 + 逻辑跑在哪

### 2.1 匹配算法

**`edit_note`（raw str_replace）**

- 在**原始文本**（含标签注释、defs 行）上匹配 `old_string`。
- `old_string` 必须在全文中**唯一出现**：0 次→报"未找到"，>1 次→报"不唯一，请补上下文"。AI 重试。
- 命中后 `new_content = old.replace(old_string, new_string)`（首处替换，已保证唯一）。
- AI 通过 `read_note` 看到 raw 文本；做散文小改时 `old_string` 选不含标记的子串即可。

**`set_tag`（归一化前缀匹配，块级）**

- 对每个块文本 `stripTagMarker()` 后，找**归一化文本以 anchor 开头**的块，要求唯一。
- 命中 → 取该块 `BlockRange` → `setBlockTagChange(doc, range, tagId)` 产出 `ChangeOp`。
- 复用 `tags/model.ts` 现成逻辑，0 行新几何代码。

两者都产出**新全文**，交给 Rust 走 `apply_edit`（第 4 节）。Rust 不碰语义，只落盘——"Rust 是唯一状态源"不变。

### 2.2 逻辑跑在哪 + sidecar 怎么拿到笔记全文

结构化操作（`edit_note` 的 replace、`set_tag` 的 ChangeOp）必须跑 `tags/model.ts`、`blocks/ranges.ts`、`tasks.ts` 这套**纯 TS 逻辑**。现在这套逻辑在前端 `src/note/`，sidecar 是独立 package 拿不到。

**方案 A（采用）：抽共享包。** 把 `tags/model.ts`、`blocks/ranges.ts`、`tasks.ts` 的纯逻辑抽到 `shared/note-logic/`，前端和 sidecar 都 import。sidecar 跑逻辑产出新全文→发 `apply_edit` 给 Rust。理由：DRY，前端（用户拖拽改块）和 sidecar（AI 改块）用**完全相同**的语义；这三个文件已是纯函数、有测试，搬迁 = 改目录 + 改 import 路径。Rust 仍是唯一写入方。

**sidecar 取全文用 pull 模式**：工具 `execute()` 里 `await deps.getNoteText(target)`，经新增协议 `GetNoteText { call_id, target? }` / `NoteText { call_id, content, found }` 往返一次（镜像现有 `apply_write` 的 call_id 模式）。每次写前拉最新，天然抗并发编辑——用户正在改的笔记，AI 写前重读，匹配不上就干净报错。`read_note` 也走同一条 pull，把现在空实现的 `getNoteText` 一次性补上。

> 备选方案 B（sidecar 复制最小子集）与 C（Rust 跑结构化操作）已否弃：B 逻辑两份易漂移，C 要在 Rust 重写 tag 标记语法最易错。

## 3. 权限气泡的往返协议 + 气泡 UX

"凡写必确认"——气泡在每次写的热路径上。核心是把它接进现有 `apply_write` 往返，不另起一套。

### 3.1 往返流程

```
sidecar tool execute():
  1. old = await deps.getNoteText(target)        // pull 当前全文
  2. new = compute(old)                           // str_replace 或 ChangeOp
  3. preview = buildPreview(tool, old, new)       // 给气泡看
  4. result = await deps.requestWrite({ target, toolName, old, new, preview })
       │
       ▼  sidecar → Rust: ApplyEdit { call_id, note_id, target, tool_name, old_content, new_content, preview }
  5. Rust: emit `permission://request` 给前端气泡
  6. 前端气泡: 用户选模式 + 点 允许/拒绝 → invoke `resolve_permission({request_id, decision, write_mode})`
  7. Rust:
       • 拒绝  → 回 ApplyEditResult { call_id, denied: true }
       • 允许  → 并发校验（见 3.2）→ 按 write_mode 决定是否 snapshot → 写 new → 广播 note://updated
                 → 回 ApplyEditResult { call_id, ok: true, version? }
  8. sidecar 拿到结果 → tool 返回给 AI（拒绝则告诉 AI"用户拒绝了"）
```

### 3.2 并发校验（第二道防线）

Rust 收到允许后，先 `fs::read_to_string(path)` 比对 `old_content`：**若文件已被用户改得和 AI 当时读的不一样**，直接拒绝并回 `{ ok:false, error:"笔记已变更，请重读" }`，让 AI 重新 `getNoteText` 再算。内容锚点之外的第二道并发防线——即便锚点匹配过了，落盘前再确认世界没变。`write_note` 也吃这个校验。

### 3.3 协议改动

- `ApplyWrite` → 改名 **`ApplyEdit`**，加字段 `target / tool_name / old_content / preview / write_mode`。
- `ApplyWriteResult` → **`ApplyEditResult`**，加 `denied?: bool`（区分"被拒绝"与"出错"）。
- 新增 Tauri 事件 **`permission://request`** + 命令 **`resolve_permission`**。
- 新增 sidecar↔Rust 往返 **`GetNoteText` / `NoteText`**（第 2.2 节）。

### 3.4 气泡 UX

- **位置**：assistant dock 旁的浮层（复用 `assistant-history-popover` 的浮层机制），不挡编辑区。
- **内容**（tool-aware，sidecar 算好 `preview` 传上来，Rust 只透传）：

  | 工具 | 气泡卡片 |
  |---|---|
  | `edit_note` | 统一 diff（散文改动） |
  | `write_note` | 整篇 diff，标注"整篇覆写" |
  | `set_tag` | 语义卡：块「anchor 预览」→ 打上「review」标签（不显示 marker 注释） |
  | `tag_create` | 新建标签「review」#e5484d（色块预览） |
  | `tag_delete` | 删除「review」，N 处标记将一并清除 |

- **按钮**：`允许写入 ▾` + `拒绝`。`允许写入` 带下拉选写入模式（第 4 节）。v1 不做"本次会话内免确认"——先贯彻凡写必确认。
- **阻塞**：气泡在 → 该 tool 的 promise 挂起 → AI 这一轮停在这。不设自动超时；assistant 显示"等待确认…"。多个写请求排队，一次只弹一个。
- **路由**：气泡发到持有该 conversation 的窗口（笔记窗的 assistant 区，或独立助手窗）。找不到 UI（纯后台）→ 直接 `denied`（对齐 Pi 的 `hasUI` 语义）。

## 4. 版本与写入模式

**取消"每次写自动快照"。快照改为气泡里用户选的写入模式，且只对 piece（写作区）出现。**

### 4.1 气泡的"允许"= 主操作 + 下拉

```
┌─────────────────────────────────────┐
│ AI 想用 set_tag 给「量子隧穿…」块   │
│ 打上 review 标签                     │
│   ┌──────────────┐  ┌─────────────┐ │
│   │ 允许写入   ▾ │  │   拒绝      │ │
│   └──────────────┘  └─────────────┘ │
│   下拉项（仅 piece 出现）：          │
│     • 直接写入          (默认)       │
│     • 保存快照后写入                 │
└─────────────────────────────────────┘
```

| 目标文件 | 气泡选项 | 行为 |
|---|---|---|
| **piece（写作区）** | 直接写入 / 保存快照后写入 | 选"快照"→ `snapshot(old,"ai")` → 写 new，回传版本号；选"直接"→ 只写 |
| **`_inbox` / `_tasks`** | 仅"直接写入"（无下拉） | 后端不快照（`starts_with('_')` 返回 0），只写 |
| **散文档（根目录 .md）** | 仅"直接写入"（无下拉） | 散文档不给版本（产品决策） |

`write_mode` 由前端 `resolve_permission` 带回；Rust 按 mode 决定是否调 `snapshot`。`ApplyEditResult.version` 仅在 snapshot 模式下有值。**Rust 守卫**：即便收到 `write_mode:"snapshot"`，仅对 `kind==="piece"` 执行快照；其余目标忽略 snapshot（前端本就不对它们显示下拉，此为后端兜底，避免散文档被意外快照）。

### 4.2 采集区会话内撤销

`_inbox`/`_tasks` 无版本快照，AI 写入后**跨会话不可回退**。会话内撤销由前端实现：把 AI 写入（`note://updated`）作为**单个可撤销的 CodeMirror 事务**应用，而非整篇静默重载，⌘Z 可撤一次。零后端改动。跨会话仍不可回退——采集区是草稿，接受此代价。

> 实现注意：`old_content` 并发校验比对的是磁盘文件，不是编辑器未保存缓冲。用户有未保存输入时 AI 写入的缓冲冲突是已知边界，v1 不解决。

## 5. 权限演进路径 + Pi SDK 落点

### 5.1 演进序列（不在 v1 做，设计留口子）

1. **会话级记忆**：气泡加"本轮内允许 set_tag"→ 该 conversation 内同类免确认。`resolve_permission` 加 `remember: "session"|"tool"`，Rust 维护会话内放行表。
2. **全局每工具策略**：设置页给每工具 `auto/ask/deny`，持久化到 config。`ApplyEdit` 前 Rust 先查策略表，`auto` 直放、`ask` 弹气泡、`deny` 直接拒。
3. **风险分层**：可回退写（带快照）auto、破坏性写 ask——届时可从"凡写必确认"平滑降级。`old_content` 并发校验和（piece 的）快照兜底始终在，是降级前提。

### 5.2 Pi SDK 落点（不重造轮子）

- 自定义工具仍用 `defineTool` / `customTools` / `tools: [...]` / `noTools: "builtin"`，和现在一样。
- `tool_call` 事件已转发为 `{type:"tool", phase:"start"|"end"}`——气泡"等待确认…"态挂在 `phase:"start"`，落盘后 `phase:"end"`。
- **不**用 Pi 的 `ctx.ui.confirm`：sidecar 跑的是 SDK 会话不是交互模式，`ctx.ui` 不可用；气泡走自己的 Tauri 事件往返。`project_trust` / `BashSpawnHook` 与本设计无关。
- 权限闸**实现在 sidecar 工具层**（`requestWrite` 里发 `ApplyEdit` 等结果），不依赖 Pi 的权限钩子——写本来就委托给 Rust，闸自然落在"请求 Rust 写"这一步。

## 6. 错误边界 + 测试策略

### 6.1 错误与边界

| 情形 | 处理 |
|---|---|
| `edit_note` old_string 未找到 / 不唯一 | 工具返回错误，AI 重读 `getNoteText` 再试 |
| `set_tag` anchor 未命中 / 不唯一 | 同上 |
| `set_tag`/`tag_*`/`list_tags` 的 target 不是 `_inbox` | 工具报错"标签只在采集区可用" |
| 用户拒绝 | 工具返回"用户拒绝了此操作"，AI 不应反复重试 |
| 并发：`old_content` ≠ 当前磁盘文件 | Rust 拒绝，回"笔记已变更，请重读"，AI 重读重算 |
| 找不到 UI 窗口（纯后台） | 直接 `denied` |
| `tag_create` 颜色被占用 | 回当前 `freeColors`，AI 重选 |
| 气泡无人响应 | AI 阻塞等待，不自动超时；用户可 `agent_cancel` 取消整轮 |
| `getNoteText` target 不存在 | 报错 |

### 6.2 测试策略

- **纯逻辑（共享包）**：`tags/model`、`blocks/ranges`、`tasks` 现有测试随搬迁；新增 anchor 归一化前缀匹配、唯一性校验、str_replace 替换正确性与歧义拒绝。
- **sidecar `note-tools`**：mock `deps.getNoteText`/`requestWrite`，断言各工具从 old→new 的变换正确、preview 生成正确（现有 `note-tools.test.ts` 模式）。
- **协议**：`ApplyEdit`/`ApplyEditResult` 含新字段 `write_mode`/`denied`/`preview` 的序列化（现有 `protocol.test.ts` 模式）。
- **Rust `agent.rs`**：`apply_edit` 的 direct vs snapshot 两条路径、`old_content` 并发拒绝、permission resolve 往返（现有 tempdir 测试模式）。
- **前端**：气泡按工具渲染对应卡片；AI 写入作为单个可撤销事务应用、⌘Z 恢复（`editor.test.ts` 模式）。

## 影响面

- `sidecar/src/note-tools.ts`、`sidecar/src/agent.ts`、`sidecar/src/protocol.ts`：工具从 2 个扩到 7 个；协议加 `ApplyEdit`/`ApplyEditResult`/`GetNoteText`/`NoteText`。
- `src-tauri/src/agent.rs`：`handle_apply_write` → `handle_apply_edit`，加并发校验、write_mode 分支、permission 事件与命令。
- 新增共享包 `shared/note-logic/`（从 `src/note/tags/model.ts`、`src/note/blocks/ranges.ts`、`src/note/tasks.ts` 抽出），前端 import 路径随之调整。
- 前端：气泡组件（`src/assistant/` 或 `src/note/`）、`permission://request` 订阅、`resolve_permission` 调用、AI 写入作为可撤销 CodeMirror 事务应用。
- 系统提示 `sidecar/src/tutor-prompt.ts`：更新工具说明（7 个工具的用途与"凡写必确认"约定）。

## 开放问题

- 散文档的版本 UI 缺口（后端 `starts_with('_')` 会快照散文档，但前端版本列表只对 piece 展示）：本设计让散文档在 AI 写时不给快照下拉，与"散文档不给版本"一致；散文档在其他路径是否补版本 UI 属独立议题，不在本 spec。
