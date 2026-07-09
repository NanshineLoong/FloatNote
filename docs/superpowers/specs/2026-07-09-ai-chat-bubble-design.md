# AI 对话气泡完善设计

- 日期：2026-07-09
- 状态：已批准（待写实现计划）
- 范围：`sidecar/src/agent.ts`、`sidecar/src/protocol.ts`、`src/note/agent.ts`、`src/assistant/render.ts`、`src/assistant/assistant.ts`、`src/assistant/permission-bubble.ts`、`src/assistant/styles.css`、新增 `src/assistant/markdown.ts`、新增 `src/assistant/blocks.ts`
- 关联 spec：`2026-07-09-markdown-rendering-design.md`（笔记编辑器 live-preview，会沉淀 `renderInline` 纯函数，本 spec 复用之）

## 1. 背景与现状

FloatNote 已接入 Pi SDK（sidecar + `src/assistant`），AI 对话在笔记窗口底部 dock 展开。基于真实代码的现状：

1. **只渲染文本**：`sidecar/src/agent.ts:131-153` 的 `translateEvent` 把 `thinking_*` / `toolcall_*` 事件 `return null` 全部丢弃；`displayMessagesFromSession` + `messageText`（L347-386）把 `AssistantMessage.content` 数组（本是 `(TextContent | ThinkingContent | ToolCall)[]` 分块）拍平成纯文本。tool call 统一渲染成固定文案「AI 正在整理笔记…」。
2. **闪烁是 bug**：`src/assistant/assistant.ts:106` 每来一个 token 就 `scroll.replaceChildren(renderMessages(state))` 全量重建整个消息列表 DOM；`.chat-msg` 带 `msg-in` 进场动画，`replaceChildren` 产生的新节点每次重放动画 → 肉眼闪烁 + 滚动跳动（L107 手动 `scrollTop = scrollHeight` 勉强兜底）。
3. **permission 弹窗已分类但未统一**：`src/assistant/permission-bubble.ts` 已按 `detail.kind` 分 `diff/tag_assign/tag_create/tag_delete` 四种渲染，固定悬浮在 dock 右上角（`styles.css:395`，`position:absolute`）。问题：与上下文消息脱节、write_note 无可编辑白板形态、多动作并发时拥挤。
4. **无 Markdown**：`renderMessage`（`render.ts:204`）用 `textContent`，AI 输出的 markdown 原样显示。`src/note/inline.ts` 的 `renderInline`（带 HTML 转义 + 链接 scheme 白名单）可复用但未被气泡使用。
5. **无复制按钮**：`src/assistant/` 下零 clipboard 调用。

数据层基本具备（Pi SDK 已有分块事件），瓶颈在「渲染层全量重建 + 事件被过滤 + 消息模型太扁平」三处。本 spec 做可控改造，不推翻现有架构。

## 2. 目标

1. 消灭闪烁：渲染层改增量更新，已完成消息节点复用、流式消息按块增量。
2. 分块渲染：消息流由「块序列」构成——`text`（自然语言气泡）、`thinking`（默认折叠）、`action`（tool call 卡片，带允许/拒绝）、`error`。文本气泡只说话，动作卡片只动作，互不嵌套。
3. 动作卡片流内化 + 全定制：动作卡作为流内独立块出现；按 `kind` 定制 body（清单 / chip / 可编辑白板），footer 统一允许/拒绝 + 写入模式。
4. Markdown：支持简单内联（加粗/代码/链接）+ 块级（代码块/列表/标题），复用安全转义；AI 以自然语言为主，markdown 仅作偶发兜底。
5. 复制按钮：assistant 的 text block hover 时在气泡下方浮出复制按钮，复制原始 markdown 文本。

## 3. 非目标

- 不引入 lit/react 等响应式框架，保持 vanilla TS。
- 不做消息重排序/撤销/编辑历史。
- thinking 不落库（折叠状态仅内存）。
- 不做代码块语法高亮在气泡内的独立实现（气泡代码块用等宽浅灰容器即可，与编辑器 live-preview 的 highlight.js 体系分离，见 §6 风险）。
- dock 固定 permission 弹窗保留为兜底，不做移除。

## 4. 总体策略

心智模型对标 Claude.ai / ChatGPT / Cline：**消息流 = 一串平级块的序列**。text / thinking / action / error 都是兄弟块，不互相塞。

渲染架构采用**定向增量更新（方案 A）**：聊天流形态是「只追加」（消息只 append、最后一条在流式），无重排序需求，故用 `messageId → DOM 节点` Map 复用已完成消息、对流式消息按 `blockId` 增量更新，而非全量重建。这是消灭闪烁的最小充分改动。

## 5. 详细设计

### 5.1 消息模型升级（协议 + 状态）

#### 5.1.1 类型定义

把扁平 `ChatMessage { role, text }` 升级为分块模型。`src/assistant/render.ts` 现有 `ChatMessage`（L27-31）改为：

```ts
type Block =
  | { id: string; kind: "text"; text: string }
  | { id: string; kind: "thinking"; text: string; collapsed: boolean }
  | { id: string; kind: "action"; tool: string; detail: EditPreviewDetail;
      status: "pending" | "approved" | "rejected" | "done"; writeMode?: WriteMode }
  | { id: string; kind: "error"; text: string };

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; blocks: Block[] };
```

`EditPreviewDetail` / `WriteMode` 复用 `protocol.ts:61-71` 现有定义，新增 `kind: "add_task"` 变体（清单预览）。

#### 5.1.2 sidecar 事件转发

`sidecar/src/agent.ts:131-153` 的 `translateEvent` 不再丢弃事件：

- `text_delta` → `{type:"delta", blockKind:"text", text}`（不变，补 `blockKind`）。
- `thinking_start` → `{type:"block_start", blockKind:"thinking", id}`；`thinking_delta` → `{type:"delta", blockKind:"thinking", text}`；`thinking_end` → `{type:"block_end", blockKind:"thinking"}`。
- `toolcall_start` → `{type:"block_start", blockKind:"action", id, tool}`；`toolcall_delta` 累积 arguments；`toolcall_end` → `{type:"block_end", blockKind:"action", detail}`（detail 由 `note-tools.ts` 的 EditPreview 生成函数产出）。
- `tool_execution_start/end` 仍产生 action block 的 `status` 变更（pending → done）。

`displayMessagesFromSession`（L347-367）+ `messageText`（L369-386）不再拍平：遍历 `AssistantMessage.content`，按 `TextContent/ThinkingContent/ToolCall` 顺序产出 blocks（历史会话恢复时用）。

#### 5.1.3 前端协议与 reducer

`src/note/agent.ts:11-30` 的 `ChatDisplayMessage` 同步升级为分块；`src/assistant/render.ts:51` 的 `reduceEvents` 按 `blockId` 增量 append：

- `block_start` 开新 block（push 到末位 message 的 blocks）。
- `delta` 追加到「当前末位 block」（若 kind 不匹配则开新 block）。
- `block_end` 标记 block 完成（不再接受 delta）。
- action block 的 `status` 由 tool_execution 与 permission resolve 驱动。

### 5.2 渲染层（定向增量更新，消灭闪烁）

`src/assistant/assistant.ts:104-115` 的 `rerender` 不再 `scroll.replaceChildren(renderMessages(state))`，改为：

```ts
function rerender(state: ChatState, dom: { map: Map<string, HTMLElement>; scroll: HTMLElement }) {
  reconcileMessages(dom.scroll, state.messages, dom.map);
}
```

`reconcileMessages`（新增 `src/assistant/blocks.ts`）：

1. 遍历 `state.messages`，按 `message.id` 在 Map 里找已有节点；找不到才新建（`renderMessage`）并 `appendChild`。已完成消息节点**不重建** → 进场动画不重放 → 闪烁消失。
2. 对最后一条 assistant 流式消息，调 `reconcileBlocks(node, message.blocks, blockMap)`：
   - 按 `block.id` 找已有块节点；找不到才新建块节点 `appendChild`。
   - text block：若已存在，只更新其末尾 text node（`node.lastChild.textContent += delta`，或重设整段 `textContent`——后者对单块成本可接受且更简单，**实现期二选一，倾向重设 textContent 但不重建块容器**，避免进场动画重放）。
   - thinking block：更新折叠计数文案。
   - action block：按 `status` 切换 class，不重建。
3. 删除 Map 中已不在 state 的消息/块（会话切换时）。

**滚动策略**：仅当「新增消息或新增 block」时 `scrollTop = scrollHeight`；纯 text delta 不强制滚动（若用户已上滚阅读则不抢滚动，见 §6 风险）。

`renderMessage` / 各 block 的 DOM 产出仍由 `render.ts` 负责，但改为返回可复用节点而非一次性 fragment。

### 5.3 动作卡片（全定制，流内）

每张 action 卡 = `header(图标 + 中文标题) + body(按 kind 定制) + footer(允许/拒绝 + 写入模式 select)`。header 标题沿用 `permission-bubble.ts:32-38` 的 `TOOL_LABEL` 映射。footer 统一，body 按 `detail.kind`：

| kind | body 渲染 |
|---|---|
| `diff`（write_note / edit_note） | **可编辑白板卡**：Markdown 渲染（§5.4）+ 可点击聚焦编辑（contenteditable 或内嵌 textarea）；右上「展开」按钮在窗口内开 dialog 全屏编辑。dialog 复用 `src/note/preview.ts` 的 CodeMirror live-preview 体系（见 §5.3.1）。 |
| `tag_assign` | 「块「…」→」+ 彩色 `.tag-chip` |
| `tag_create` | 「新建标签」+ chip |
| `tag_delete` | 文本「删除标签「…」，N 处标记将清除」 |
| `add_task`（新增） | 清单样式卡：复选框 + 任务文本，可增删行（预览 AI 要加的条目） |

卡片状态视觉：`pending`（亮、footer 可点）→ `approved/done`（变灰、footer 隐藏，卡体保留可见作为执行记录）→ `rejected`（淡出）。状态切换只改 class，不重建节点。

允许/拒绝仍走 `invoke("resolve_permission", {requestId, decision, writeMode})`。白板卡编辑后的内容回写到该 action block 的 `detail`（用户可改 AI 提议的笔记再批准；批准时把编辑后内容一并提交，需 sidecar 侧 `resolve_permission` 接受可选 `editedPayload`——见 §5.3.2）。

#### 5.3.1 白板卡 dialog

- 内联态：卡体是只读 Markdown 渲染 + 一个「编辑」入口；点「编辑」切为内嵌可编辑（轻量 textarea + 实时预览，或直接 contenteditable）。
- 点「展开」：在笔记窗口内开一个 overlay dialog（非新窗口），内嵌 CodeMirror 编辑器，复用 `src/note/editor.ts` + `preview.ts` 的 live-preview，保持与主笔记一致的编辑体验。dialog 有「保存到卡片」与「取消」。
- dialog 不引入新依赖；复用现有编辑器实例化逻辑。

#### 5.3.2 sidecar 接受编辑后内容

`resolve_permission` 命令（`src-tauri/src/commands.rs` 或对应处）扩展：可选 `editedPayload` 字段，sidecar 在执行 write_note/edit_note 前用编辑后内容替换 AI 原提议。若实现期评估改动过大，回退为**只读白板卡**（不可编辑，仅 diff 预览），编辑能力留作后续迭代（见 §6 风险）。

### 5.4 Markdown 渲染（新增 `src/assistant/markdown.ts`）

- **内联**：直接复用 `src/note/inline.ts` 的 `renderInline(text)`（已带 `escapeHtml` + `safeHref` 链接 scheme 白名单，拒绝 `javascript:/data:/vbscript:`）。
- **块级**：在 `src/assistant/markdown.ts` 写一个轻量 block renderer，先把文本按 fenced code block（```` ``` ````）切段，代码段输出 `<pre class="chat-codeblock"><code></code></pre>`（等宽 + 浅灰圆角背景，**不接 highlight.js**，纯文本转义），非代码段交给 inline renderer 逐行处理标题（`#`）/列表（`-`/`*`/`1.`）/段落。**不引入 marked/markdown-it**（与 `2026-07-09-markdown-rendering-design.md` 的非目标一致）。
- 输出 HTML 前统一经 `escapeHtml`，链接统一经 `safeHref`。代码块内容 `textContent` 设置（非 innerHTML）。
- system prompt 引导 AI：以自然语言口语回复为主，markdown 仅用于「偶发的简单格式」（加粗重点、短代码、清单），不要输出长 markdown 故事。

### 5.5 复制按钮

- 仅 `.chat-assistant` 的 text block：hover（`@media (hover: hover)`；触控端常显低对比度）时在气泡下方浮出小「复制」按钮。
- 点击 `navigator.clipboard.writeText(block 的原始 markdown 文本)`（复制原文，非渲染后纯文本）。
- 成功后按钮文案短暂变「已复制」（约 1.2s 后复原）。
- 截断/降级：`navigator.clipboard` 不可用时回退 `document.execCommand('copy')` 临时 textarea 方案。

### 5.6 dock 固定弹窗的定位

`permission-bubble.ts` 的 dock 固定弹窗**保留为兜底**：用于非流式即时 permission 请求（如 sidecar 主动触发的写操作而消息流尚未建立对应 action block 时）。流内 action 卡是主交互位。两边通过同一 `requestId` 同步状态——一处批准/拒绝后，另一处同步切 `approved/rejected` 并禁用，避免重复操作。

## 6. 风险与回退

- **增量更新与「用户上滚阅读」**：token delta 不强制滚底，但用户上滚时若新消息持续到达，需决定是否打断。回退：用户距底 < N px 时才自动滚（常见 chat 做法），N 实现期定（如 120px）。
- **白板卡可编辑 + sidebar 回写**：`resolve_permission` 接受 `editedPayload` 涉及 sidecar/protocol/commands 三处改动。若超期，回退为只读白板卡（仅 diff 预览），编辑能力后续迭代。
- **白板卡 dialog 复用 CodeMirror**：在 overlay 内实例化编辑器可能与主笔记窗口的编辑器实例冲突（状态/插件）。回退：dialog 内用轻量 textarea + `renderInline` 预览，不上 CodeMirror。
- **块级 markdown 自写 renderer 的正确性**：边界（嵌套列表、代码块内含 ```` ``` ````、缩进代码）易错。回退：先只做内联 + 平坦列表/标题/代码块，嵌套作为后续；或退化为只内联。
- **action block 与现有 dock 弹窗的状态同步竞态**：两处都可能先收到 resolve。以 `requestId` 为幂等键，先到者生效，后到者只刷新 UI。需在 `permission-bubble.ts` 与流内 action 卡共用一个 resolve 入口。
- **thinking 折叠状态不落库**：会话切换/恢复后 thinking 块重新折叠（默认值）。可接受。
- **add_task 作为新 detail kind**：需 sidecar `note-tools.ts` 的 add_task 工具产出 `EditPreviewDetail` 的 `add_task` 变体。若该工具尚未产出预览，回退为 add_task 用通用文本卡，清单样式后续。
- **闪烁修复的 text block 更新方式**：重设 `textContent`（不重建容器）与追加 text node 二选一。前者更简单但每 token 重设整段文本，长文本下成本线性；若卡顿，改为追加 text node。

## 7. 测试

- **Vitest**：
  - `src/assistant/markdown.test.ts`：内联（加粗/代码/链接/`javascript:` 链接被过滤）、块级（标题/列表/fenced code 转义）的输入→HTML。
  - `reduceEvents` 的 block 增量：`block_start/delta/block_end` 序列产出的 blocks 结构、kind 不匹配时开新 block。
  - `reconcileMessages`/`reconcileBlocks` 的 DOM 复用：同 id 消息/块节点不重建（可用标记 class 验证节点身份保持）。
- **手动**：`npm run tauri dev`，macOS 上验证：闪烁消失（长回复不闪）、thinking 折叠/展开、action 卡四 kind + add_task 清单、白板卡内联编辑 + dialog 展开、Markdown 渲染、复制按钮、用户上滚时不抢滚动。
- **类型**：`npm run build` 通过 tsc；sidecar 端 `tsc` 通过。
- **跨平台**：纯前端/CSS 为主；clipboard 在 macOS/Windows 均用 `navigator.clipboard`（Tauri webview 支持），两平台验证。dialog overlay 两平台验证。
