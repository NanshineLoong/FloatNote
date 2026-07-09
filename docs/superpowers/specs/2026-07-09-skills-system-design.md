# Skills 系统接入设计

- 日期：2026-07-09
- 范围：在 FloatNote 的 AI 助手（sidecar / Rust / 前端）上接入 Skills：复用 Pi SDK 原生 Skills 机制，提供右键 Socrates 小人选择 + 输入框 `/skill:name` 引用两种显式入口，以及基于描述的自动加载。
- 状态：待评审

## 背景与现状

FloatNote 的 AI 助手由三段构成：

- **前端** `src/assistant/assistant.ts`：Socrates 小人（`.assistant-bot`）+ 输入框（`.assistant-input`）+ 历史浮层 + 权限气泡，经 `src/note/agent.ts` 的 `invoke` 包装调 Tauri 命令。
- **Rust** `src-tauri/src/agent.rs` + `commands.rs`：经 stdio JSONL 与 sidecar 通信，把 sidecar 事件转发为 `agent://event`，把写请求转为 `permission://request`。
- **sidecar** `sidecar/src/`（独立 package）：基于 `@earendil-works/pi-coding-agent`（即「PI SDK」）+ `@earendil-works/pi-ai`。`agent.ts` 用 `createAgentSession` 拉起会话，`note-tools.ts` 注册 note 工具，`tutor-prompt.ts` 是系统提示，`protocol.ts` 是 JSONL 协议。

### 关键现状：Pi SDK 原生就有 Skills，但被关闭

`sidecar/src/agent.ts:308` 的 `DefaultResourceLoader` 当前显式禁用了全部资源加载：

```ts
new DefaultResourceLoader({
  cwd, agentDir: getAgentDir(),
  noExtensions: true, noSkills: true,
  noPromptTemplates: true, noThemes: true, noContextFiles: true,
  systemPromptOverride: () => TUTOR_SYSTEM_PROMPT, // 丢弃 base（base 本会含 skill 描述）
});
```

Pi SDK 导出一套与 Claude Code 同构的成熟 Skills 系统（遵循 [Agent Skills 标准](https://agentskills.io)）：`loadSkills` / `loadSkillsFromDir` / `formatSkillsForPrompt` / `Skill` / `SkillFrontmatter` / `parseSkillBlock`。skill 以 `SKILL.md` + frontmatter 存放，`formatSkillsForPrompt` 把描述以 XML 注入系统提示（progressive disclosure），`session.prompt("/skill:name args")` 原生展开为该 skill 全文 + 用户参数。skill 发现位置包括 `~/.pi/agent/skills/`、`.pi/skills/`、包内 `skills/`、`additionalSkillPaths`、CLI `--skill`。frontmatter 支持 `disable-model-invocation`（仅显式调用）。

因此接入 Skills 的本质是**重新打开并正确接线 Pi SDK 已有的能力**，而非从零造一套——与 `docs/superpowers/specs/2026-07-08-ai-tools-design.md §5.2` 已定调的「Pi SDK 落点（不重造轮子）」一致。

### 调研结论（Claude Code / Cursor / Pi SDK 对比）

| 维度 | Claude Code | Cursor | Pi SDK |
|---|---|---|---|
| 载体 | `.claude/skills/<name>/SKILL.md` | `.cursor/rules/*.mdc` | `SKILL.md`，`.pi/skills` / `~/.pi/agent/skills` / 包 `skills/` / `--skill` |
| 元数据 | frontmatter `name`/`description` | `description`/`globs` | `name`/`description`/`disable-model-invocation`/`allowed-tools`… |
| 自动加载 | 描述进系统提示，模型按需 `read` 全文 | 按 globs 注入 | `formatSkillsForPrompt()` 描述进提示，模型 `read` 全文 |
| 显式调用 | `/skill-name` | `/` 命令面板 | **`/skill:name args`**，`session.prompt()` 原生展开 ✅ |
| 跨工具复用 | — | — | 可直接挂 `~/.claude/skills`、`~/.codex/skills` |

三者机制一致；Pi SDK 的 Skills = Claude Code 的 Skills（同一标准）。

## 设计目标

1. **不重造轮子**：复用 Pi SDK 的 skill 发现 / frontmatter 解析 / 描述格式化 / `/skill:name` 展开。
2. **两种显式入口**：右键 Socrates 小人弹 picker；输入框 `/` 触发自动补全下拉。选中后以 `/skill:name ` 前缀提交。
3. **自动加载**：skill 描述进系统提示；模型按需调 `read_skill(name)` 读全文（progressive disclosure）。
4. **守住现有架构边界**：sidecar 不在运行时碰文件系统（skill 全文启动时读入内存）；Rust 仍是 note 写入的唯一状态源；工具面只增一个只读的 `read_skill`。
5. **YAGNI**：v1 只做 bundled + 用户全局 skill；项目级 skill、prompt templates、extensions、marketplace 暂缓。

## 1. 总体策略

三处接线：

1. `DefaultResourceLoader`：**保持 `noSkills: true`**（不让 loader 自己发现 skill，避免它扫 Pi 默认目录 `~/.pi/agent/skills` 等，与我们的 skill 集合不一致）。skill 描述改由 `skills.ts` 单一加载后，在 `systemPromptOverride` 里手动拼接：`(base) => TUTOR_SYSTEM_PROMPT + "\n\n" + formatSkillsForPrompt(ourSkills)`（`base` 此刻为空，丢弃无妨）。其余 `noExtensions/noPromptTemplates/noThemes/noContextFiles` 保持 `true`。
2. 新增**作用域限定的 `read_skill` 自定义工具**：`{ name }` → 返回该 skill 全文。只接受已加载 skill 的 `name`，拒绝越界路径。运行时从内存 map 取，零 FS 访问。
3. 显式调用走 `session.prompt("/skill:name …")` 原生展开，**前端不做语义解析**，只负责把选中 skill 拼成 `/skill:<name> ` 前缀。

> **同源原则**：`skills.ts` 是 skill 的唯一加载源——系统提示里的描述（经 `formatSkillsForPrompt`）与 `read_skill` 返回的正文都来自同一份内存 `Skill[]` / `Map<name, body>`，杜绝「提示里有、正文取不到」的不一致。

## 2. Skill 存储

| 位置 | 用途 | 可写 | v1 |
|---|---|---|---|
| 随 app 分发的 `resources/skills/`（只读） | 内置导师 skill | 否 | ✅ 3 条 |
| `~/.floatnote/skills/` | 用户自加 skill | 是 | ✅ |
| 项目空间内 `.pi/skills/` | 项目级 skill | 是 | ⏸ 暂缓（需 trust 模型） |

- 两条路径由 Rust 在启动时解析（bundled = app 资源目录；用户全局 = `~/.floatnote/skills/`）并下发给 sidecar；sidecar 的 `skills.ts` 用 `loadSkillsFromDir({ dir, source })` 对每目录聚合（`includeDefaults: false`，不扫 Pi 默认目录）。
- skill 文件格式遵守 Agent Skills 标准：目录含 `SKILL.md`，frontmatter 必填 `name`（1-64 字符，小写字母/数字/连字符）+ `description`（≤1024 字符）；可选 `disable-model-invocation`。
- 预留：未来把 `~/.claude/skills` 作为额外 skill 目录下发即可复用 Claude Code skill 生态，v1 不开。

## 3. 内置 3 条导师 skill

均只复用现有 note 工具，不引入新能力。放在 `src-tauri/resources/skills/<name>/SKILL.md`。

1. **`socratic-review`** — 对当前 piece 逐点做苏格拉底式追问薄弱处，不直接给答案；以一个推动下一步的问题收尾。
2. **`inbox-to-actions`** — 读 `_inbox`，提炼行动项用 `edit_note` 写进 `_tasks`；写前说明意图，凡写必确认。
3. **`structure-piece`** — 把 `_inbox` 散点组织成一篇 piece 的结构化大纲/草稿，可写入 piece 文件。

每条 `SKILL.md` 含 frontmatter（`name`+`description`）+ 正文指南（引用现有 7 个 note 工具的用法与「凡写必确认」约定，直接复用 `tutor-prompt.ts` 里的工具说明段落）。

## 4. 组件改动

### 4.1 sidecar

- **新 `sidecar/src/skills.ts`**：
  - 接收 skill 目录列表（bundled + 用户全局），对每目录调 Pi 的 `loadSkillsFromDir({ dir, source })` 聚合（不扫 Pi 默认目录）。
  - 启动时把每条 `Skill` 的 `SKILL.md` 全文读进内存 `Map<name, body>`（加载阶段读一次，运行时零 FS）。
  - 导出 `listSkills(): { name: string; description: string }[]`、`readSkillBody(name: string): string | null`（未知名返回 null，调用方报错）、`formatSkillsForPrompt()`（薄封装 Pi 的同名函数，作用于本模块加载的 `Skill[]`）。
  - skill 目录列表由 Rust 经协议下发（见 4.2），`skills.ts` 持有并可按需 `reload()`。
- **`sidecar/src/agent.ts`**：
  - `defaultCreateSession` 里 `DefaultResourceLoader` 保持 `noSkills: true`；`systemPromptOverride: () => TUTOR_SYSTEM_PROMPT + "\n\n" + formatSkillsForPrompt()`（描述来自 `skills.ts`，同源）。
  - `AgentRunner` 增加 `listSkills()` 方法（同步走内存 map，不往返 host）；`prompt` 路径不变（`/skill:name` 由 `session.prompt` 原生展开）。
  - `createAgentSession` 的 `customTools` 增加 `read_skill`（来自 `note-tools.ts`）；`tools` 数组追加 `"read_skill"`。
- **`sidecar/src/note-tools.ts`**：新增 `read_skill` 工具定义。入参 `{ name: string }`；execute 调注入的 `deps.readSkillBody(name)`，返回 body 或抛「未知 skill: <name>」。不接受路径，只接受已加载 skill 的 `name`，天然防越界。
- **`sidecar/src/protocol.ts`**：
  - 加 `HostToSidecar` 成员 `{ type: "list_skills" }`。
  - 加 `SidecarToHost` 成员 `{ type: "skills_list"; skills: { name: string; description: string }[] }`。
  - `/skill:name` 显式调用**不加协议**，走现有 `prompt` 消息的 `userText`。

### 4.2 Rust

- **`src-tauri/src/agent.rs`**：
  - 在 sidecar 往返里处理 `list_skills`：向 sidecar 写 `list_skills` 行，收 `skills_list` 行回传。
  - 启动 sidecar 后，把解析好的 skill 路径（bundled 资源路径 + `~/.floatnote/skills/`）经 `configure` 扩字段或新 `set_skill_paths` 消息下发给 sidecar（与 `agent_configure` 同期或紧随）；sidecar 收到后调 `skills.ts.reload()`。bundled 路径用 Tauri 资源路径解析；用户目录用 `dirs`/手动拼 home。
- **`src-tauri/src/commands.rs`**：新增 `#[tauri::command] agent_list_skills(state) -> Vec<{name, description}>`，内部走 sidecar 往返（镜像现有 `agent_send` 的 call/回事件模式，但 `list_skills` 是同步请求-响应，可复用一次性往返）。
- **`lib.rs`**：`invoke_handler` 注册 `agent_list_skills`。
- **`src-tauri/tauri.conf.json`** / 打包配置：把 `resources/skills/**` 纳入 app 资源（Tauri `resources` 或 `bundle.resources`）。

### 4.3 前端

- **新 `src/assistant/skill-picker.ts`**：
  - `mountSkillPicker({ bot, input, listSkills })`：给 `.assistant-bot` 挂 `contextmenu`（右键）弹 skill 菜单；给 `.assistant-input` 挂输入监听，当行首（或光标前最近空白后）出现 `/` 时弹出过滤下拉。
  - 复用现有浮层模式（仿 `assistant-history-popover`、`src/note/tags/bar.ts` 的 `openContextMenu` + `closeFloating`）。
  - 选中 skill → 把输入框内容置为 `/skill:<name> `（保留已有文本作为参数前缀的拼接策略：若已有文本则在其前插入 `/skill:<name> ` 并留空格），focus 回输入框。
  - 返回 handle（destroy）。
- **`src/assistant/assistant.ts`**：
  - `AssistantDeps` 加 `listSkills: () => Promise<{ name: string; description: string }[]>`。
  - `mountAssistant` 里调 `mountSkillPicker`，传入 `bot`、`input`、`deps.listSkills`。
  - picker 的浮层纳入现有 `onDocumentPointerDown` 外点关闭逻辑。
- **`src/note/agent.ts`**：加 `agentListSkills(): Promise<{ name: string; description: string }[]>`，`invoke("agent_list_skills")`。
- **`src/note/main.ts`**：装配 assistant 时把 `agentListSkills` 注入 deps（现有 `agentSend` 等同处）。

## 5. 数据流

- **枚举**：前端 `agentListSkills()` → Rust `agent_list_skills` → sidecar `list_skills` → `listSkills()` 走内存 map → `skills_list` 回传 → Rust 回前端 → 前端缓存供 picker + `/` 下拉。缓存在会话内有效；右键/`/` 时若缓存空则按需拉取。
- **显式（picker）**：右键小人 → 菜单列 skill → 选中 → 输入框置 `/skill:<name> ` → 用户可续写参数 → Enter 提交 → `agentSend("/skill:name …")` → `session.prompt` 原生展开为 skill 全文 + `User: <args>` → 正常 delta/tool/done 流式。
- **显式（`/`）**：输入 `/` → 下拉按 `name`/`description` 过滤 → 选中插入 `/skill:<name> ` → 同上。
- **自动**：skill 描述（`formatSkillsForPrompt` 的 XML）已在系统提示 → 模型判断匹配 → 调 `read_skill(name)` → sidecar 从内存 map 返回全文 → 模型照 skill 指南执行（可能再调 note 工具，走现有权限气泡）。

## 6. 错误 / 边界

| 情形 | 处理 |
|---|---|
| `read_skill` 未知名 / 越界路径 | 工具抛「未知 skill: <name>」，AI 重试或放弃；只接受 `name`，不接受路径，天然防遍历 |
| skill 目录缺失 / 为空 | 不加载、不报错；picker 空态「还没有可用的 skill」 |
| frontmatter 缺 `description` | Pi 原生不加载（标准行为），其余 skill 正常 |
| 用户输入 `/skill:不存在` | Pi 展开失败 → 经现有 `error` 事件回显 |
| bundled 资源路径解析失败（打包/平台差异） | 仅用户全局 skill 生效，降级不崩；启动记日志 |
| skill 全文过大 | 启动时读入内存；单 skill 一般 < 数 KB，不设硬上限，v1 接受 |
| 名称冲突（同名 skill） | Pi 原生保留首个并告警；picker 去重显示 |

## 7. 测试

- **sidecar `skills.test.ts`**：临时目录放样例 `SKILL.md`（含/缺 `description`、`disable-model-invocation`），断言 `listSkills()` 枚举与过滤、`readSkillBody()` 返回全文、未知 name 返回 null、`formatSkillsForPrompt()` 输出含各 skill 描述；多目录聚合。
- **sidecar `note-tools.test.ts`**：`read_skill` 工具命中返回 body、未知名抛错、不接受路径入参（现有 mock deps 模式）。
- **sidecar `protocol.test.ts`**：`list_skills` / `skills_list` 序列化与 `createLineDecoder` 往返（现有模式）。
- **sidecar `agent.test.ts`**：`defaultCreateSession` 用的 loader 保持 `noSkills:true` 且 `systemPromptOverride` 拼接了 `formatSkillsForPrompt()` 的输出（断言 TUTOR + skill 描述 XML 都在）；`/skill:name` 经 mock session 的 `prompt` 入参正确传递。
- **Rust `agent.rs`**：`list_skills` 往返（现有 tempdir + 假 sidecar 模式）；`agent_list_skills` 命令返回结构。
- **前端 `skill-picker.test.ts`**：右键 bot 弹菜单、渲染 skill 列表；输入 `/` 弹下拉、按名/描述过滤；选中插入 `/skill:<name> ` 并 focus；外点关闭（jsdom + 现有 assistant 测试模式）。

## 影响面

- 新增：`sidecar/src/skills.ts`、`src/assistant/skill-picker.ts`、`src-tauri/resources/skills/{socratic-review,inbox-to-actions,structure-piece}/SKILL.md`。
- 改动：`sidecar/src/agent.ts`（loader 选项 + customTools）、`sidecar/src/note-tools.ts`（加 `read_skill`）、`sidecar/src/protocol.ts`（两条消息）、`src-tauri/src/agent.rs`（`list_skills` 往返 + skill 路径下发）、`src-tauri/src/commands.rs` + `lib.rs`（`agent_list_skills`）、`src/assistant/assistant.ts`（deps + 挂 picker）、`src/note/agent.ts`（`agentListSkills`）、`src/note/main.ts`（装配）、`src-tauri/tauri.conf.json`（resources）。
- 不动：note 工具集（7 个）、权限气泡、版本/写入模式、会话持久化、tutor 角色定位。

## 范围（YAGNI）

v1 做：bundled + 用户全局 skill；显式（picker + `/`）+ 自动（`read_skill` + 描述进提示）。

暂缓：项目级 `.pi/skills`（需 trust 模型）；prompt templates；extensions；skill marketplace；`allowed-tools` 强制；`~/.claude/skills` 挂载；skill 全文大小硬上限；会话级「免确认」与 skill 的联动。

## 开放问题

- `list_skills` 的 Rust↔sidecar 往返是复用现有 call_id 异步模式还是加一条同步请求-响应：倾向加一次性同步往返（`list_skills` → `skills_list`），因为无流式、无并发；实现计划阶段定。
- bundled skill 资源在 dev（`npm run tauri dev`）与打包后的路径解析差异：dev 下指向源码 `src-tauri/resources/skills/`，打包后走 Tauri 资源路径；实现阶段验证两端。
