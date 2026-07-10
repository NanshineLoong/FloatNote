# Rust 后端

`src-tauri/src/lib.rs` 负责应用装配、Tauri invoke handler、窗口、tray 和快捷键注册。`AppState` 保存运行期共享资源，包括 sidecar 进程、当前活动笔记、待裁决编辑、watcher 自写抑制和配置。

## 领域与 adapter

- `commands.rs` 与 `commands/{agent,chat,settings}.rs` 是 Tauri command adapter。它们只做 payload 转换、授权、错误映射和领域调用。
- `notes.rs`、`project.rs`、`versions.rs` 负责文件、项目空间和版本快照；项目空间文件操作不应写入 command adapter。
- `agent.rs` 是对 `agent/{protocol,handlers,runner}.rs` 的模块入口；这些模块负责 JSONL 契约、sidecar 生命周期及编辑处理。
- `chat_history.rs`、`paths.rs`、`watcher.rs` 处理聊天记录、跨平台路径与文件变更。

文件写入由 Rust 独占。写入采用原子替换；当保存带有 expected mtime 时，mtime 不一致会返回冲突而不是覆盖磁盘内容。版本快照与 watcher 自写抑制也在这个边界内执行。
