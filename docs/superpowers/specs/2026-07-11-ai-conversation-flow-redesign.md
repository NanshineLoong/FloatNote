# AI 对话流重设计

- 日期：2026-07-11
- 状态：已确认，待实施计划
- 范围：`src/assistant/`、`src/platform/agent.ts`、sidecar agent 事件协议；必要时涉及 Rust permission 事件载荷
- 取代范围：细化并修正 `2026-07-09-ai-chat-bubble-design.md` 中的消息布局、thinking、工具块、权限状态和复制交互；Markdown 与增量 DOM 的既有方向继续保留
- 参考：仓库内 `CodePilot` 的过程折叠、工具对象摘要、连续读取聚合和权限状态设计，但不采用其无气泡的工程控制台布局

## 1. 背景与代码审计结论

当前 `src/assistant/` 已具备分块消息、增量 DOM、Markdown、thinking、action card 与 permission fallback，但实现和视觉模型仍有以下问题：

1. `.chat-msg` 直接作为 `.assistant-scroll` 的子节点，而 `.assistant-scroll` 不是纵向 flex 容器；定义 `gap: 20px` 的 `.chat-messages` 没有实际创建。因此 `align-self: flex-end` 无效，用户气泡错误地出现在左侧，消息间距也没有生效。
2. `pending` 事件创建一条内容为“正在思考…”的正式 AI 文本块。它与真实 thinking 事件是两套状态，并错误占据气泡位置。
3. 复制按钮只在父气泡 hover 时出现，按钮又定位在气泡外；鼠标经过气泡与按钮之间的空隙时会失去 hover。流式文本更新后，按钮回调还可能保留首次渲染时的旧文本。
4. `buildActionCard` 的允许/拒绝回调捕获首次创建时的 `block`。permission request 后虽然 DOM 被补入 `requestId`，回调仍读取旧对象，导致按钮无效。
5. action block 只持有工具名，缺少规范化的操作对象、参数摘要与结果，无法可靠渲染“读取 piece.md”或聚合为“3 个文件”。
6. action 的单一 `status` 把权限决定与执行状态混在一起；`approved` 可被后续 `tool end` 覆盖为 `done`，用户看不到稳定的“已允许”或“已拒绝”。
7. 既有模型允许 text / thinking / action 作为平级块，但视觉设计仍倾向把一次执行过程看成 AI 正文之前的单一区域。真实事件可能多次交错：过程 → AI 文本 → 过程 → AI 文本。

本设计选择“块级时间线”：用户气泡、AI 文本、过程段、权限卡、工具结果和错误均为有序的平级内容块；气泡只承载对话文本。

## 2. 产品边界

### 2.1 默认可见性

采用摘要优先策略：

- 运行中显示轻量状态和当前工具摘要。
- 完成的过程段默认折叠，保留类似“已处理 3 个文件 · 2 项操作”的摘要入口。
- 展开后展示工具名称、操作对象、结果摘要、错误与可公开的 thinking 摘要。
- 不展示或存储模型隐藏的完整推理，不把原始 JSONL、协议载荷或技术日志作为普通用户界面。

### 2.2 非目标

- 不把聊天整体改造成 CodePilot 式无气泡控制台。
- 不在本轮引入 React/Lit 或重写现有增量 DOM 架构。
- 不要求首版代码块语法高亮；安全、排版与复制优先。
- 不设计完整开发者日志查看器。
- 不增加会话级或全局自动批准策略。

## 3. 消息布局与视觉层级

### 3.1 消息列表结构

`.assistant-scroll` 直接成为纵向 flex 消息列表：

```css
.assistant-scroll {
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
```

不新增未被其他逻辑需要的 `.chat-messages` 包装层。`reconcileMessages` 仍直接操作 scroll 子节点。

### 3.2 对齐与宽度

- 用户消息：右对齐，`width: fit-content`，最大宽度 72%，保留蓝色气泡和右下短圆角。
- AI turn：左对齐，最大宽度 88%。其中 text block 使用 cream/白色气泡；process、action、permission、error 各自使用对应表面，不套进 AI 文本气泡。
- 不增加每条消息头像；角色由对齐、表面、宽度与间距共同表达。

### 3.3 间距节奏

- 完整轮次之间：24px。
- 同一轮中用户气泡到第一个 assistant block：16px。
- assistant turn 内部相邻 block：10–12px。
- 聚合过程段内部工具行：4–6px。
- 权限卡内部标题、摘要、预览和操作区继续使用 8px 体系。

消息间距由结构性选择器或 turn 容器表达，不能依赖每个 block 偶然的 margin。会话切换、历史恢复与流式追加必须使用同一套布局规则。

## 4. 有序 Block 流

### 4.1 核心规则

一条 assistant turn 是一个严格有序的 block 序列，而不是“过程附件 + 最终回复”。合法序列包括：

```text
process → text → process → permission → text → error → text
```

reducer 按事件到达顺序追加或更新块。任何聚合都不得改变跨类型块的顺序。

### 4.2 建议模型

```ts
type AssistantBlock =
  | { id: string; kind: "wait"; label: string }
  | { id: string; kind: "text"; text: string; streaming: boolean }
  | { id: string; kind: "process"; items: ProcessItem[]; summary: string;
      collapsed: boolean; running: boolean }
  | { id: string; kind: "permission"; callId: string; tool: ToolDescriptor;
      preview: EditPreviewDetail; decision: PermissionDecision;
      execution: ExecutionState; writeMode: WriteMode }
  | { id: string; kind: "error"; message: string; recovery?: RecoveryAction };

type ProcessItem = {
  id: string;
  callId?: string;
  category: "thinking" | "read" | "search" | "write" | "other";
  toolName?: string;
  label: string;
  targets: string[];
  status: "running" | "succeeded" | "failed";
  resultSummary?: string;
  error?: string;
};

type PermissionDecision = "pending" | "allowed" | "denied";
type ExecutionState = "waiting" | "running" | "succeeded" | "failed" | "cancelled";
```

具体实现可保留现有 action block 名称，但必须表达上述信息和双轨状态，且不能继续依赖单一 `pending/approved/rejected/done` 枚举。

### 4.3 text 分段

- 相邻 text delta 更新当前 text block。
- thinking/tool/permission/error 到来后，下一个 text delta 新建 text block。
- 因此过程 → 文本 → 过程 → 文本会自然渲染成四个有序块。

## 5. 等待与 thinking

### 5.1 等待首个输出

用户发送后创建轻量 `wait` 块或 turn 级 transient 状态，显示灰色“正在准备回复…”及低干扰动态图标。它不是 `.chat-block-text`，没有气泡、阴影或复制按钮。

首个真实事件到来时：

- text：wait 原位替换为 text block；
- thinking/tool：wait 原位替换为 process block；
- permission：wait 原位替换为 permission block；
- error/done without content：wait 移除并渲染错误。

### 5.2 thinking 展示

- 模型显式提供的 thinking 内容作为 process item，默认仅显示“思考中…”或完成后的可公开摘要。
- 应用可根据工具事件生成不含隐藏推理的过程说明。
- 最新运行中的 process 段默认展开；离开运行态后自动折叠。
- 每个 process 段独立保存折叠状态，不把整条 assistant turn 合为一个过程面板。

## 6. 工具调用、对象与聚合

### 6.1 事件载荷

tool start 必须携带或可推导：

- 稳定 `callId`；
- `toolName`；
- 规范化类别（read/search/write/other）；
- 操作对象，如目标文件、标签或笔记；
- 可显示的参数摘要。

tool result 必须按 `callId` 回填：成功/失败、结果摘要及可选错误。前端不能再通过“最近一个 pending action”猜测匹配对象。

### 6.2 聚合规则

仅聚合相邻、同类别的 process item：

- text、permission、error 或不同类别工具会立即结束当前聚合段。
- 1–2 个读取操作逐项显示。
- 3 个以上连续读取/搜索操作折叠为“3 个文件”或“检索 4 项”；展开后列出路径与单项状态。
- 标题必须包含动作和对象，不使用只有“正在读取文档”这类无对象文案。
- 相同路径去重用于摘要计数，但展开详情保留真实调用记录。

### 6.3 状态反馈

- running：spinner + 当前动作，如“读取 piece.md”。
- succeeded：完成图标 + 结果摘要；不必为每行显示绿色，图标和文字共同表达状态。
- failed：错误图标 + 原因 + 恢复入口。
- 长运行操作可显示经过时间，但本轮不要求强制停止按钮。

## 7. 写入与权限请求

### 7.1 原位升级

写入工具 `tool start` 到来时立即创建可见 process/action 项，显示“正在准备修改 piece.md”。收到 `permission://request` 后，通过 `callId` 或显式关联 ID 把该项原位升级为 permission block；不能等待 permission 才首次渲染写入状态。

permission 卡保留在真实事件位置，不统一搬到 turn 底部。dock permission bubble 只作为无法建立会话/调用关联的异常兜底，不作为常规双入口。

### 7.2 权限交互

- 卡片标题说明动作与对象，例如“修改 piece.md 的标题层级”。
- 显示语义摘要和可展开 diff/标签详情；工具内部名可作为低优先级辅助信息。
- 按钮为“允许”“拒绝”，piece 继续提供 direct/snapshot 模式。
- 点击后立即禁用所有操作并将 `decision` 更新为 allowed/denied，防止重复提交。
- resolve 从当前 DOM dataset 或集中状态按 `callId` 查询最新数据，不能捕获首次 render 的 block 对象。
- invoke 失败时恢复可操作状态或进入明确的 permission resolution error，并提供重试。

### 7.3 决定与执行双轨

界面必须能区分：

- 已允许 · 正在写入
- 已允许 · 写入成功
- 已允许 · 写入失败
- 已拒绝

`tool end` 只更新 execution，不能覆盖 decision。“已拒绝”保留在原位作为会话记录，不通过大幅淡出隐藏。

## 8. AI 正文、Markdown 与错误

### 8.1 正文内容

继续使用现有安全 Markdown renderer，支持：

- 普通文本、段落、标题、列表、引用；
- 加粗、链接与行内代码；
- fenced code block。

危险链接协议继续由 allowlist 拦截，代码内容使用文本方式注入。代码块横向滚动，并提供独立复制图标；首版不强制语法高亮。

### 8.2 错误层级

- 工具错误：显示在对应 process item 或 permission block 内，说明原因和恢复动作。
- Markdown/单块渲染失败：该块退化为纯文本并显示轻量错误，不影响其他块。
- 整轮失败：才使用独立 error block。
- 文件并发变化等可恢复错误应提供“重新读取”或“重试”入口。

## 9. 复制与重试

### 9.1 可发现性

- 用户气泡与 AI text block 下方保留稳定操作区。
- 复制与重试均为纯图标按钮，不显示常驻文字。
- 桌面端默认以约 45% 不透明度可见，hover/focus 提升对比；不能通过 `pointer-events: none` 让按钮默认不可点击。
- 图标按钮保留 `title`、`aria-label`、44px 等效点击热区或不小于现有共享 icon button 的可用热区，以及清晰 focus ring。

### 9.2 复制反馈与数据来源

- 点击复制后图标短暂变为勾，`title`/`aria-label` 更新为“已复制”，约 1.2 秒后复原；可选 `aria-live="polite"` 通知。
- 按钮从当前 block state 或 DOM dataset 查询最新原始 Markdown，不能闭包捕获初次 render 文本。
- clipboard 失败时给出轻量错误反馈；保留现有 legacy copy 降级路径。
- 代码块复制仅复制该代码块；消息级复制复制原始 Markdown。

## 10. 增量渲染与状态一致性

- 保留 `messageId → DOM` 与 `blockId → DOM` 的增量复用。
- process 与 permission 更新只修改已有节点状态，不重建整个消息或触发进场动画。
- 事件更新以稳定 `callId` 查找具体 item/block，移除 `setLastActionStatus` 式“最近一个动作”推断。
- 流式 Markdown 可继续重绘 `.chat-text-content`，但操作按钮必须在内容容器之外，避免 `fillMarkdown` 清空按钮。
- 自动滚动仍遵循 near-bottom 阈值；新增过程段、权限卡与 text block 均使用相同粘底判断。
- 动画使用 150–300ms，并遵循 `prefers-reduced-motion`。

## 11. 模块边界

建议在不引入框架的前提下收紧职责：

- `render/state.ts`：有序 block reducer、权限与执行双轨状态、聚合边界。
- 新增或拆分 `process-model.ts`：工具规范化、对象摘要和相邻聚合纯函数。
- `render/view.ts`：text/wait/thinking/error 的 DOM 骨架。
- `process-view.ts` 或现有 `action-card.ts`：process 段、工具行、permission 卡投影。
- `blocks.ts`：仅负责稳定 ID 对应的 DOM reconcile，不包含业务匹配规则。
- `assistant.ts`：订阅事件、invoke 与统一 resolve 协调；不在这里猜测最近动作。
- `permission-bubble.ts`：共享 preview 类型；dock fallback 仅处理无法关联的异常请求。
- `src/platform/agent.ts` 与 sidecar protocol：稳定 callId、工具对象、结果与错误合同。

若工具协议或 DTO 发生变化，同步更新 `docs/architecture/frontend.md`、`docs/architecture/data-flow.md`、`docs/architecture/sidecar.md` 和相关 AGENTS 指南。

## 12. 测试与验收

### 12.1 reducer 与纯逻辑

- pending 不创建 text bubble；首个真实事件替换 wait。
- `process → text → process → text` 顺序保持不变。
- 相邻 text delta 合并；被 process/permission/error 打断后新建 text block。
- 3+ 连续 read 聚合；1–2 个不聚合；text 打断后开启新 process 段。
- callId 精确匹配并发或交错工具结果。
- permission decision 与 execution 独立更新，tool end 不覆盖 allowed/denied。
- permission invoke 失败进入可恢复状态。

### 12.2 DOM 与交互

- `.assistant-scroll` 的 flex 布局使用户消息真实右对齐。
- 同轮 16px、轮次间 24px、assistant block 间 10–12px。
- 已有 message/block DOM 在 delta 与状态更新时保持节点身份。
- 写入 tool start 立即可见，permission request 在原位置补全。
- action 按钮读取最新 request/call ID，允许与拒绝均只 invoke 一次。
- 点击后立即显示“已允许”或“已拒绝”；随后展示执行成功/失败。
- 复制图标默认可见、键盘可聚焦，鼠标无需穿越 hover 空隙。
- 流式结束后复制得到最新完整原始 Markdown；代码块复制范围正确。
- Markdown 安全转义与危险协议测试继续通过。

### 12.3 手动与跨平台

- `npm test`、`npm run build`、sidecar smoke test。
- `npm run tauri dev` 验证长回复、交错工具、连续读取、权限允许/拒绝、并发文件变化和用户上滚。
- macOS 与 Windows 验证 clipboard、focus ring、0.5px 发丝边、滚动和系统字体降级。
- reduced-motion 下不播放进场位移动画；运行状态仍以静态文字/图标可理解。

## 13. 实施顺序建议

1. 修复 `.assistant-scroll` flex 布局、间距与稳定可见的图标操作区。
2. 修复 action 回调旧闭包与权限决定反馈，先解决现有功能性 Bug。
3. 协议补稳定 callId、工具参数/对象、结果与错误。
4. reducer 改为 wait + 有序 process/text/permission 流，并拆分 decision/execution。
5. 实现相邻工具聚合、过程段折叠和原位 permission 升级。
6. 完善代码块复制、错误恢复、跨平台与无障碍验证。

该顺序允许先交付高确定性的布局与权限 Bug 修复，再扩展工具信息模型，避免一次性重写整个 assistant。
