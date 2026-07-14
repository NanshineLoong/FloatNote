# Rust 后端

`src-tauri/src/lib.rs` 负责应用装配、Tauri invoke handler、窗口、tray 和快捷键注册。`AppState` 保存运行期共享资源，包括 sidecar 进程、当前活动笔记、待裁决编辑、watcher 自写抑制和配置。

## 领域与 adapter

- `commands.rs` 与 `commands/{agent,chat,settings,versions}.rs` 是 Tauri command adapter。它们只做 payload 转换、授权、错误映射和领域调用。
- `notes.rs`、`project.rs`、`versions.rs` 负责文件、项目空间和版本快照；项目空间文件操作不应写入 command adapter。
- `agent.rs` 是对 `agent/{protocol,handlers,runner}.rs` 的模块入口；这些模块负责 JSONL 契约、sidecar 生命周期及编辑处理。
- `chat_history.rs`、`paths.rs`、`watcher.rs` 处理聊天记录、跨平台路径与文件变更。
- `selection_intent.rs` 是纯鼠标选择状态机；`selection_probe.rs` 通过 macOS
  Accessibility 从 focused element、children、ancestors 读取文本；
  `selection_monitor.rs` 在独立 CFRunLoop 上运行 listen-only event tap。FFI
  callback 只投递元数据，AX、窗口和剪贴板操作全部在 worker 执行。
- `popup.rs` 为每次有效捕获分配 `generationId`。提交、关闭和前端 payload
  都携带该代次，过期的异步捕获不能覆盖或关闭更新的弹窗。

文件写入由 Rust 独占。写入采用原子替换；当保存带有 expected mtime 时，mtime 不一致会返回冲突而不是覆盖磁盘内容。版本快照与 watcher 自写抑制也在这个边界内执行。版本预览只调用只读的 `read_version`；恢复携带 expected mtime，通过冲突检查后才写回正文，并仅在当前内容与目标版本不同时新增一个名为“恢复前备份”的安全快照。版本名称保存在 manifest 的 `summary` 字段；manifest 经临时文件安全替换，删除版本先更新索引再移除对应 Markdown 快照，失败时避免留下指向已丢失内容的条目。

划词弹窗显示时不主动聚焦，但允许用户首次点击时成为 key window 并立即
执行按钮。自动与快捷键模式共用 AX-first 捕获；FloatNote 自身 AX 失败时
读取 CodeMirror 快照，外部应用才允许定向 `Cmd+C` 兜底。自动失败静默，
专用快捷键允许显示短暂的空结果反馈。

AI 配置以 `Config.ai_settings` 持久化：六个固定 provider profile 加一个可空的
`active_provider_id`，不再读取旧的单 provider 或通用 connection 字段。
`save_ai_provider` 保存未启用档案时直接落盘；保存当前档案或
`set_active_ai_provider` 切换提供商时，先等待 sidecar 的关联配置结果，再写入
配置文件。所有 `Config` 写入（provider、通用设置、快捷键、窗口状态和工作目录）
共用异步事务锁，配置文件先写同目录临时文件
再替换；配置或持久化失败会保留原 active profile，并确认恢复旧运行配置；
关闭最后一家只把 active ID 设为空，不向 sidecar 发送 configure。
