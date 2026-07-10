# Node sidecar

sidecar 是独立 Node 进程，入口为 `sidecar/src/main.ts`，通过 stdin/stdout JSONL 与 Rust host 通信。它运行 Pi coding-agent 会话，不直接打开或写入用户笔记文件。

- `runner.ts` 管理会话、prompt 和取消。
- `model.ts` 配置 AI provider/model。
- `event-translate.ts` 将 Pi 事件转换为 host protocol 事件。
- `protocol.ts` 定义 JSONL 消息和行编解码。
- `note-tools.ts` 提供读取、编辑、写入、标签与技能工具；文件访问均通过 host 请求回到 Rust。
- `skills.ts` 加载技能目录；`matching.ts` 提供 sidecar 专用文本匹配。

`agent.ts` 是兼容 barrel，不是运行逻辑的归属点。共享 Markdown/标签规则来自 `@floatnote/note-logic`；sidecar 专用逻辑保留在 sidecar 内。
