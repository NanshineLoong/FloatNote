# Node sidecar

sidecar 是独立 Node 进程，入口为 `sidecar/src/main.ts`，通过 stdin/stdout JSONL 与 Rust host 通信。它运行 Pi coding-agent 会话，不直接打开或写入用户笔记文件。

- `runner.ts` 管理会话、prompt 和取消。
- `one-shot.ts` 为受限一次性任务构造上下文；当前只接受 `translate`，按中文占比决定中译英或其他语言译中。`runner.oneShot` 直接调用 completion，不创建 session、不加载历史且不暴露工具。
- `model.ts` 把六个固定 profile 解析为 PI provider/model，并计算自动 thinking。
- `event-translate.ts` 将 Pi 事件转换为 host protocol 事件；`tool-title.ts` 从参数生成安全短标题，wire 事件只携带 `callId`、标题、状态和清理后的短错误，不携带参数或工具返回正文。写权限请求仍通过独立受控通道携带对应的 `toolCallId`。
- `protocol.ts` 定义 JSONL 消息和行编解码。
- `runner.ts` 打开会话时遍历 Pi 当前活动分支，把 assistant 的 thinking/text/toolCall 按原顺序转换为结构化 blocks，并用后续 toolResult 的 `toolCallId` 恢复 succeeded/failed/incomplete；无法解析的单块会被跳过，原 session JSONL 不重写。
- `runner.ts` 在调用 Pi `SessionManager.open` 前验证 session 文件存在，避免旧索引中的错误路径被 Pi 静默初始化成一段新的空会话。
- 用户从历史回合重试或编辑重发时，host 发送 `rewind`（该用户回合稳定的 session entry ID）。sidecar 通过 Pi `SessionManager` 将活动叶节点移动到该回合之前，并以关联的 `rewind_result` 确认结果；旧分支仍保留在 append-only session 文件中，但不再属于活动上下文。下一次 prompt 会写入新分支，随后 `session_synced` 让 Rust 刷新持久化对话索引而不重置前端草稿状态。
- `configuration-gate.ts` 串行 provider 配置变更；栅栏初始保持关闭，直到 host 下发启动 `configure` 或 `configuration_ready`。因此即使新建或恢复会话先于启动配置到达，也会等待明确的配置决策；其他 prompt、工具回调和取消消息仍可并发处理。
- Pi 默认并行执行同轮工具，但 `edit`、`write`、`create_piece` 与标签 mutation 工具都声明为 `sequential`。`extensions/` 注册的 `ls/read/find/grep/edit/write/create_piece` 是 FloatNote 虚拟工作区实现，不是 Pi 的本地文件系统实现；只读与网络工具仍可使用默认并行执行。
- `workspace/` 通过关联 JSONL 请求读取当前 project space。`ls` 将其投影为已选定、平铺的笔记集合，返回的 path 都是项目内根级标识而非包含项目名的文件系统路径。Inbox 的 `read` 返回 clean Markdown 和独立只读的标签/引用语义上下文；`grep` 搜索同一 clean 坐标空间。`edit` 支持基于同一原文的多个唯一、互不重叠替换并映射 v2 标注；`write` 只覆写已有笔记，带标注 Inbox 必须使用 `edit`；`create_piece(title, content)` 从自然标题生成跨平台安全文件名，并以 create-only 语义新建 piece。
- `web-tools.ts` 提供 `web_search` / `web_fetch`。网络结果作为不可信外部资料返回；fetch 会限制协议、重定向、响应大小和内容类型，并拒绝本机、私网与 link-local 地址。
- `skills.ts` 把 host 下发目录转为不可变 generation；设置窗口的目录发现、来源
  标记和导入由 Rust host 拥有。Pi ResourceLoader 从 generation 生成原生
  `<available_skills>`，并展开 `/skill:name`；FloatNote 不手工拼接目录或 Skill 正文。

本地写入遵循 `tool_call → prepare → review → lease → execute/commit → Rust atomic write`。
创建与覆写在工具层即分离：`create_piece` 只能对应 `create`，`write` 只能对应
`rewrite`；Rust 在审核边界再次核对工具名与 operation，防止调用语义漂移。
权限 hook 先生成结构化预览并等待 host；批准后只保存与 `toolCallId`/conversation
绑定的一次性 lease，工具 `execute` 消费后才请求提交。旧工具名与旧 session 不做兼容迁移。

`agent.ts` 是兼容 barrel，不是运行逻辑的归属点。共享 Inbox codec、annotation
变换与 Markdown/标签规则来自 `@floatnote/note-logic`；sidecar 专用逻辑保留在 sidecar 内。

模型解析优先复用 PI 的 OpenAI、DeepSeek、Anthropic、Moonshot 中国区和 Z.AI
元数据；智谱保留 Z.AI 兼容元数据但改用中国区通用地址。百炼与 PI 未收录的
厂商模型使用 128K 上下文、16K 最大输出、文本输入和零价格的 provider 专属
后备定义。OpenAI 自定义 Base URL 固定走 Chat Completions，Anthropic 自定义
Base URL 保持 Messages，百炼始终走 OpenAI-compatible Chat Completions。

`configure`/`clear_configuration` 与 `configure_result` 通过 `callId` 关联。sidecar
先构建候选模型，并为所有已打开对话重建候选会话；全部成功后才整体替换运行
配置，任一失败则销毁候选并保留旧会话。所有返回 host 的错误统一隐藏当前与候选
API Key、认证头、URL 凭据和敏感查询参数。模型元数据标记 `reasoning` 时默认
选择 `high`，由 PI 的 qwen/deepseek/zai/原生 Anthropic/OpenAI 映射产生厂商参数；
百炼托管的已知推理模型统一覆盖为 qwen thinking 格式；未知且无法可靠识别能力
的模型不启用 thinking。

`new_session` / `new_session_result` 通过 `callId` 关联，host 只会在 session 安装
确认后发送首个 prompt。`one_shot` / `one_shot_result` 也通过 `callId` 关联，并等待同一个 configuration
gate 完成启动决策；未知任务在协议或任务构造边界拒绝。失败结果只携带清理后的短
错误。`discard_session` 用于首条 prompt 尚未被接受时的事务补偿，释放内存 session；
安装与 discard 竞态时 tombstone 会销毁晚到 session 并清理其内部派生的文件路径；
它不会出现在已经取得正式 request ID 的会话路径上。

每个 turn 的 `done` 都携带 `completed`、`cancelled` 或 `failed` outcome。用户取消
映射为 `cancelled`，不会触发空响应诊断；模型失败保留清理后的真实错误；只有正常
完成且完全没有正文、思考或工具输出时，才报告“助手这次没有返回内容”。
