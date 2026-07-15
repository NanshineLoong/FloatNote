# 运行时边界与数据流

```text
WebView → src/platform → Tauri command → Rust domain
                                      ↕
                           JSONL stdin/stdout protocol
                                      ↕
                                Node sidecar
```

## 笔记写入

前端自动保存与直接编辑经 Tauri command 到 Rust `notes`。Rust 执行 mtime 冲突校验、原子写入和 watcher 自写抑制。sidecar 的写入请求不会直接触及文件系统：Rust 将其保存为 pending permission，用户同意后再执行并广播 `note://updated`。

Inbox 的 v2 metadata 编解码只发生在 frontend/sidecar 的共享纯逻辑边界；
CodeMirror 与 Agent 都消费 clean Markdown offsets，Rust host 继续传递并持久化不透明
字符串。metadata 不进入可编辑文档，也没有数据库或第二个 metadata 文件。

## AI 对话

sidecar 通过 JSONL 发出流式事件、读取请求和编辑建议。Rust 验证 target、处理读取/权限、将安全的事件广播为 `agent://event`。前端 `src/platform/agent.ts` 是该事件和 invoke API 的唯一入口。

## 图片与外部链接

图片通过自定义 `floatnote-img://` 协议读取，Rust 仅允许 `_assets` 下的已知图片后缀。外部链接由 Rust `open_url` 再次校验，只允许 `http`、`https`、`mailto`。CSP 明确允许 Tauri IPC、资源字体和自定义图片协议，避免 WebView 处于无策略状态。
