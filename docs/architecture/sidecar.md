# Node sidecar

sidecar 是独立 Node 进程，入口为 `sidecar/src/main.ts`，通过 stdin/stdout JSONL 与 Rust host 通信。它运行 Pi coding-agent 会话，不直接打开或写入用户笔记文件。

- `runner.ts` 管理会话、prompt 和取消。
- `model.ts` 把六个固定 profile 解析为 PI provider/model，并计算自动 thinking。
- `event-translate.ts` 将 Pi 事件转换为 host protocol 事件；工具执行事件包含 `callId`、参数、结果和错误标记，写权限请求还携带对应的 `toolCallId`。
- `protocol.ts` 定义 JSONL 消息和行编解码。
- `configuration-gate.ts` 串行 provider 配置变更；新建或恢复会话会等待该栅栏，其他 prompt、工具回调和取消消息仍可并发处理。
- `note-tools.ts` 提供动态项目笔记列表、读取、受控 piece 创建、编辑、写入、标签与技能工具；文件访问均通过 host 请求回到 Rust。Agent 不支持 loose root Markdown target。
- `web-tools.ts` 提供 `web_search` / `web_fetch`。网络结果作为不可信外部资料返回；fetch 会限制协议、重定向、响应大小和内容类型，并拒绝本机、私网与 link-local 地址。
- `skills.ts` 只负责运行时加载 host 下发的技能目录；设置窗口的目录发现、来源
  标记和导入由 Rust host 拥有，不通过 sidecar 查询。`matching.ts` 提供 sidecar
  专用文本匹配。

`agent.ts` 是兼容 barrel，不是运行逻辑的归属点。共享 Markdown/标签规则来自 `@floatnote/note-logic`；sidecar 专用逻辑保留在 sidecar 内。

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
