# 划词弹窗 AI 操作增强设计

## 1. 背景与目标

FloatNote 的全局划词弹窗目前只提供“采集”操作。弹窗会在外部应用中选中文字后出现，提前缓存选区文本、HTML 和来源，并用 `generationId` 防止旧弹窗操作影响新选区。

本功能在现有操作条中增加“翻译”和“提问”：

- **翻译**用于快速理解选中文字。结果即看即走，不创建对话、不写入历史，也不提供追问。
- **提问**允许用户先在划词弹窗内输入一个针对选区的问题，再为这次问题创建独立 AI 会话，并在 FloatNote 笔记窗口中继续对话。
- “采集”的现有行为保持不变。

成功标准：

1. 自动划词本身不调用模型；只有用户明确点击翻译或发送问题后才产生 AI 请求。
2. 翻译无需切换到 FloatNote 主窗口即可完成查看和复制。
3. 提问提交后，用户能立即在新会话中看到自己的问题、选区引用和流式回答。
4. 旧请求、失败请求和重复操作不会覆盖新选区、误清缓存或留下可见的空会话。

## 2. 范围

### 2.1 本期范围

- 划词操作条增加“翻译”和“提问”按钮。
- 同一个 `selection-popup` 窗口在操作条、翻译结果和提问输入之间切换并动态调整尺寸。
- 新增无会话的一次性翻译请求。
- 每次划词提问都创建新会话，使用当前项目或当前独立文档作为会话作用域。
- 首条用户消息持久化问题、选区文本和来源，并在重新打开历史时恢复可读结构。
- 为失败、超时、AI 未配置、选区过长和跨 generation 竞态提供明确行为。

### 2.2 非目标

- 翻译结果后的继续追问。
- 保存翻译历史、自动写入笔记或自动采集原文。
- 每次翻译前选择目标语言。
- 自动摘要、改写、解释等更多划词 AI 动作。
- 自动划词后立即调用 AI。
- 借本功能重构现有对话标题生成链路；本期只为未来的一次性任务接口预留统一形状。

## 3. 已选方案

采用按产品意图分流的混合方案：

- 翻译走独立的 one-shot AI completion，类似现有对话标题生成：无 session、无工具、无聊天历史。
- 提问复用完整聊天链路：`chatCreate → agentNewSession → agentSend`。
- one-shot 协议设计为可扩展的任务请求，本期只注册 `translate`，不提前建设通用任务注册系统，也不迁移现有标题生成。

未采用的方案：

- **翻译也创建正式会话**：虽然复用现有聊天协议，但会制造大量低价值历史并增加 session 成本，与“即看即走”冲突。
- **所有划词 AI 都只做 one-shot**：无法支持提问后的连续对话。
- **先建设完整通用 AI 任务框架**：在只确定翻译一个一次性动作时属于过度抽象。

## 4. 产品交互

### 4.1 默认操作条

有效选区出现后，弹窗显示三个并列的一级动作：

1. 采集
2. 翻译
3. 提问

操作条沿用当前不主动聚焦的显示方式，避免自动出现时打断来源应用。只有用户点击弹窗后，窗口才进入可交互焦点状态。

“采集”继续调用现有 `submit_popup_capture`，把缓存中的 `{ text, html, source }` 发送到笔记窗口，并关闭弹窗。

### 4.2 翻译状态

点击“翻译”后，同一个弹窗原位切换为翻译面板：

1. 顶部显示单行、截断的原文摘要。
2. 请求期间显示“正在翻译”和加载状态，禁止重复提交。
3. 成功后显示完整译文，以及“复制”和“关闭”操作。
4. 译文较长时，内容区在限定最大高度内滚动，弹窗不无限增高。
5. 失败后显示可读错误，并提供“重试”和“返回”。返回会恢复默认操作条。

关闭结果、按 Escape 关闭弹窗或出现新一轮选区后，译文从内存中丢弃，不进入任何持久化存储。

翻译方向自动判断：

- 输入以中文为主时，翻译为英文。
- 其他语言翻译为中文。

模型应保留段落、列表、代码、数字和专有名词，不额外解释、总结或回答原文中的问题。来源信息不发送给翻译模型。

### 4.3 提问输入状态

点击“提问”后，同一个弹窗切换为输入面板：

- 顶部显示截断的选区摘要。
- 输入框提示“针对选中文字提问…”。
- Enter 发送；Shift+Enter 换行。
- 输入为空时不发送。
- 第一次按 Escape 返回默认操作条并保留当前 generation 的缓存；回到操作条后再次按 Escape 才关闭弹窗。
- 发送过程中禁用重复提交，但保留输入内容。

### 4.4 提交后的主窗口接管

每次划词提问都创建一个新会话，不复用当前会话，也不根据是否存在活跃会话做隐式判断。

提交成功的定义是：新会话已建立，并且 `agentSend` 已返回 `agentRequestId`。达到该状态后：

1. 清除本 generation 的 popup cache。
2. 关闭划词弹窗。
3. 显示并聚焦 FloatNote 笔记窗口。
4. 打开 AI 区域并切换到新会话。
5. 用户气泡立即可见，随后展示流式回答。

不等待模型回答完成才打开窗口。用户应能确认问题已发送、看到生成状态、取消请求或继续交互。

如果问题已经成功发送，但显示或聚焦主窗口失败，会话仍保存在历史中；弹窗提示“已发送，可在对话历史中查看”，不得允许用户误以为未发送而重复提交。

## 5. 首条消息与会话规则

### 5.1 持久化格式

首条用户消息使用稳定、可读的 Markdown 结构保存问题与选区：

```md
这句话为什么强调“媒介”而不是“内容”？

> [!selection] Understanding Media · Chrome
> The medium is the message.
```

- 问题始终位于最前，便于标题生成优先理解用户意图。
- `[!selection]` callout 保存来源标题或应用名以及选区正文。
- Web 来源可携带现有安全 URL；应用来源只显示应用名。
- 构造和解析该格式应由一个纯 helper 负责，避免 popup、assistant 和历史恢复各自拼接字符串。
- 普通用户消息即使包含相似文本，也不能被错误识别为划词消息；解析器只接受完整、合法的首条 callout 结构。

### 5.2 用户气泡

用户气泡将首条消息投影为：

- 上方显示用户输入的问题。
- 下方显示较弱的选区引用卡和来源。
- 长选区默认只显示前几行，可手动展开。
- 历史会话重新打开时仍显示同一结构。

模型接收完整的问题、来源和选区正文；内部任务说明不显示在用户气泡中。

### 5.3 作用域

- 项目模式：新会话属于当前项目，`cwd` 为项目目录。
- 独立文档模式：新会话属于当前文档，`cwd` 为文档父目录。
- 当前没有可用项目或文档时，不创建会话，弹窗显示“请先在 FloatNote 中打开项目或文档”。
- 首次 prompt 不主动注入当前笔记全文或文件引用，只注入选区、来源和问题。
- 新会话从建立起沿用现有 AI 能力和当前作用域工具；本功能不额外触发工具调用，后续追问也不改变既有权限流程。

## 6. 前端状态设计

建议将 `src/popup/main.ts` 中逐步增长的布尔状态收敛为显式状态机。逻辑状态至少包括：

```ts
type PopupViewState =
  | { kind: "actions" }
  | { kind: "translate-loading"; popupRequestId: string }
  | { kind: "translate-result"; text: string }
  | { kind: "translate-error"; message: string }
  | { kind: "question-editing"; draft: string }
  | { kind: "question-sending"; draft: string; popupRequestId: string }
  | { kind: "question-error"; draft: string; message: string };
```

状态与当前 `generationId` 组合使用。收到新的 `popup-payload` 时，旧视图状态和旧结果全部重置；任何异步回调在更新 UI 前都必须同时验证 `generationId` 和 `popupRequestId`。

本文区分三种关联标识：`popupRequestId` 由弹窗为一次用户动作生成，只负责跨窗口/UI 回调去重；`callId` 由 Rust host 为 one-shot sidecar 请求生成；`agentRequestId` 是 `agentSend` 成功后返回的正式对话请求 ID。三者不得互换。

每次状态变化后复用现有“测量内容 → 调整 Tauri 窗口尺寸 → clamp/place”的流程。弹窗保持贴近原选区位置，但必须重新限制在当前显示器可见区域内。

## 7. 系统边界与数据流

### 7.1 模块职责

- `src/popup/`：瞬时交互、显式 UI 状态、问题草稿和当前 `popupRequestId`；不得导入 `src/note/` 或 `src/assistant/` 内部模块。
- `src/platform/`：新增跨 feature 的 one-shot AI DTO、invoke/event gateway，以及划词提问的跨窗口合同。
- `src/assistant/`：提供“用给定 prompt 新建会话并发送”的公开动作，内部复用现有 submit/send 状态机。
- `src/note/assistant-controller.ts`：持有当前 scope，监听划词提问请求，并协调 Assistant、窗口显示和关联结果。
- `src-tauri/src/popup.rs`：generation-aware 缓存读取/完成/关闭；不承担聊天 UI 状态。
- Rust agent host：发送 one-shot 请求、维护关联等待者、处理超时和 sidecar 返回。
- sidecar：按任务构造受限上下文并调用模型；翻译任务不加载 session、不暴露工具。

### 7.2 Popup cache

现有 `PopupCache::take` 适合“采集后立即消费”，但翻译重试和提问失败恢复要求在成功前保留选区。因此增加：

- generation-aware 的只读快照能力，返回克隆后的文本和来源。
- generation-aware 的成功完成/清除能力。
- 旧 generation 的读取、完成和关闭均不得影响新 generation。

翻译不会清除缓存。提问只有在 `agentSend` 返回 `agentRequestId` 后才完成并清除缓存。

### 7.3 一次性翻译链路

```text
popup UI
  → translate_popup_selection(generationId, popupRequestId)
  → Rust 校验 generation、长度、AI 配置和 sidecar 状态
  → HostToSidecar one_shot { callId, task: "translate", input }
  → sidecar complete（无 session、无 tools）
  → SidecarToHost one_shot_result { callId, result | error }
  → Rust 关联等待者完成 invoke
  → popup 再次验证 generationId + popupRequestId 后展示
```

one-shot 请求接口保持任务枚举形状，但本期只允许 `translate`。未知任务在 host 和 sidecar 两端都应拒绝。

Rust 为关联等待表设置约 45 秒超时；完成、失败、超时和 sidecar 断开都必须移除等待项。结果为空视为失败。

### 7.4 提问链路

提问需要当前前端 scope 和现有 Assistant 状态机，因此由笔记窗口协调，而不是在 popup 或 Rust 中复制聊天编排：

```text
popup UI
  → correlated popup-question-request { generationId, popupRequestId, question }
  → main UI 读取当前 scope，并按 generationId 获取缓存快照
  → 构造 selection callout prompt
  → AssistantHandle.startConversationWithPrompt(scope, prompt)
  → chatCreate → agentNewSession → optimistic user bubble → agentSend
  → agentRequestId 成功：main 清 popup cache，回传 success，并显示/聚焦窗口
  → 失败：回传 error，popup 保留选区和问题
```

跨窗口请求和结果必须携带 `popupRequestId`。Main 返回的旧结果不能改变新 generation 的弹窗。

## 8. 事务与失败补偿

### 8.1 AI 操作预检

翻译请求和提问创建会话前都完成以下检查：

- 当前 generation 仍有效。
- 选区不超过 12,000 个 Unicode 字符。
- 已启用 AI 提供商，sidecar 可用。

提问另外检查问题非空、当前项目或文档 scope 有效；翻译不要求 scope。

超长选区必须提示用户缩小选区，不能静默截断。

### 8.2 新会话失败

现有 `chatCreate` 会先写入历史索引，因此划词提问编排必须带补偿：

- `chatCreate`、`agentNewSession` 或 `agentSend` 在获得 `agentRequestId` 前失败时，删除刚创建的历史索引。
- 丢弃 sidecar 中刚创建但未成功提交的 in-memory session；对应 session 文件做 best-effort 清理，无法立即清理的孤立文件不进入历史索引，并可由后续维护任务回收。
- 恢复用户此前正在查看的 active conversation 和消息状态。
- popup 保持可见，保留问题草稿，允许重试。

对话一旦获得 `agentRequestId` 就不再回滚，因为模型请求已经被 sidecar 接受。

### 8.3 错误文案与恢复

- 未启用提供商：提示“尚未启用 AI 提供商”，提供“打开设置”和“返回”。
- sidecar 未连接：提示“AI 助手暂时不可用，请稍后重试”。
- 超时：提示“请求超时，请重试”。
- 无 scope：提示“请先在 FloatNote 中打开项目或文档”。
- 选区过长：提示“选中文字过长，请缩小选区后重试”。
- 其他模型错误：使用 host 已清理的安全短错误，不显示 API key、原始请求体或内部堆栈。

## 9. 并发、取消与隐私

- 一个 generation 中最多运行一个翻译或提问提交；运行期间禁用其他 AI 动作。
- 返回操作条后才能切换动作。
- 新 generation 出现时，旧 UI 请求立即失去展示资格。首版可以只忽略旧 one-shot 结果，不要求模型侧取消；host 仍必须正常清理等待项。
- `dismiss_popup` 只能清除匹配 generation 的缓存。
- 自动划词只在本机缓存选区，绝不自动发送给模型。
- 只有明确点击“翻译”或发送问题才把选区传给当前启用的 AI 提供商。
- 不新增本地翻译缓存、遥测正文或调试日志正文。

## 10. 可访问性与视觉要求

- 三个默认动作都有图标、可见文字和 `aria-label`，不能只靠图标区分。
- 加载状态使用文字和非颜色线索；遵循 `prefers-reduced-motion`。
- 翻译结果可键盘选取和复制。
- 提问输入获得焦点后遵循 Enter/Shift+Enter/Escape 规则，并提供可见焦点环。
- 浅色和深色均复用现有 semantic tokens；不引入 popup 私有颜色体系。
- 动态窗口设置最大宽度和结果最大高度；长译文内部滚动。
- 多显示器、负坐标和屏幕边缘继续使用现有逻辑坐标 clamp。

## 11. 跨平台影响

本功能不新增 macOS 专用系统 API。选区捕获和弹窗触发仍使用各平台已有能力；`selection-popup` UI、one-shot AI 协议和聊天接管设计保持平台无关。

路径、换行和来源显示必须保持 Windows/macOS 兼容。Windows 若暂时不具备与 macOS 相同的自动选区监控，已有可用触发入口仍可复用新增按钮和 AI 链路，不在本功能中另建第二套实现。

## 12. 测试与验收

### 12.1 前端单元测试

- Popup 状态机：操作条、翻译加载/成功/失败、提问编辑/发送/失败。
- Escape：提问编辑先返回操作条，操作条再关闭。
- 新 generation 重置旧结果和草稿；旧异步结果不能更新 UI。
- 空问题、重复提交和动作互斥。
- selection callout 的构造、解析、来源转义、长引用折叠投影。
- 新会话提交成功后才清 popup；失败保留草稿并恢复原会话。

### 12.2 Rust 测试

- PopupCache 的 snapshot/complete/clear generation 语义。
- 旧 generation 不能读取、完成或关闭新缓存。
- one-shot pending map 在成功、错误、超时和断连时清理。
- AI 未配置、空结果和超长输入返回稳定错误。
- Host/sidecar 新协议的 serde round-trip。

### 12.3 Sidecar 测试

- `translate` 构造无工具、无 session 的 completion。
- 中文主导输入翻英文，其他语言翻中文的提示词规则。
- 未知 one-shot task 被拒绝。
- 模型错误被转换为安全、有关联 ID 的结果。

### 12.4 集成与人工验收

1. 英文选区翻成中文；中文选区翻成英文。
2. 翻译不创建历史，关闭后结果消失。
3. 提问每次创建新会话，问题和 selection card 正确显示并可从历史恢复。
4. 提交后主窗口立即显示，用户气泡先出现，回答流式追加。
5. AI 未配置、断连、超时和发送失败均可恢复且不留下可见空会话。
6. 快速连续选择文本时，旧结果不覆盖新弹窗。
7. Escape、Enter、Shift+Enter、复制和键盘焦点行为正确。
8. 浅色/深色、多显示器边缘、长译文滚动正常。
9. 运行 `npm test`、`npm run build` 和相关 UI review；Rust 运行 `cargo test --lib`、`cargo check`、`cargo check --release`。

## 13. 文档更新

实现本功能时同步进行聚焦更新：

- `docs/architecture/data-flow.md`：one-shot 翻译和跨窗口提问链路。
- `docs/architecture/frontend.md`：popup 状态机、platform 合同和 Assistant 公开动作。
- `docs/architecture/sidecar.md`：无 session/无工具的一次性任务协议。
- 若 Tauri command/event/DTO 或模块职责最终与本设计不同，同步更新根 `AGENTS.md`、相关模块 `AGENTS.md` 或新增 ADR；不批量重写稳定文档。

## 14. 实现顺序建议

1. 定义 selection message codec 和 popup 纯状态机。
2. 扩展 generation-aware PopupCache 快照/完成语义。
3. 增加 host/sidecar one-shot translate 协议和关联等待者。
4. 完成翻译 UI、动态尺寸、复制与错误恢复。
5. 为 Assistant 增加新建会话并发送给定 prompt 的公开编排动作及失败补偿。
6. 增加跨窗口提问请求/结果合同和主窗口接管。
7. 完成视觉、集成、跨平台检查和架构文档更新。
