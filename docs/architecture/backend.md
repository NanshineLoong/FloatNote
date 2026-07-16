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

聊天历史索引的所有进程内读改写由同一把锁串行化，并通过同目录临时文件原子替换。
`updatedAt` 只表示最后一次 prompt 活动；查看或恢复会话只读取记录并绑定 sidecar
返回的真实 session 路径，不更新时间或排序。加载索引时会按 Pi session header 修复
旧版时间戳文件名、合并仍有 JSONL 的有效备份记录，并把曾因错误路径而分裂的两个
session 都保留下来；从未形成持久 session 的空白“新对话”不进入历史列表。

划词弹窗显示时不主动聚焦，但允许用户首次点击时成为 key window 并立即
执行按钮。自动、弹窗快捷键与直接采集入口都会在 AX 和剪贴板操作前拒绝
FloatNote 自身 PID，因此本软件任意窗口内的划词捕获均静默无效。外部应用
共用 AX-first 捕获并允许定向 `Cmd+C` 兜底；自动失败静默，专用快捷键在外部
应用无有效选区时仍允许显示短暂的空结果反馈。已缓存的外部选区可在弹窗成为
前台窗口后正常提交。

AI 配置以 `Config.ai_settings` 持久化：六个固定 provider profile 加一个可空的
`active_provider_id`，不再读取旧的单 provider 或通用 connection 字段。
`save_ai_provider` 保存未启用档案时直接落盘；保存当前档案或
`set_active_ai_provider` 切换提供商时，先等待 sidecar 的关联配置结果，再写入
配置文件。所有 `Config` 写入（provider、通用设置、快捷键、窗口状态和工作目录）
共用异步事务锁，配置文件先写同目录临时文件
再替换；配置或持久化失败会保留原 active profile，并确认恢复旧运行配置；
关闭最后一家只把 active ID 设为空，不向 sidecar 发送 configure。

Skill 目录清单由 Rust host 直接从打包资源、debug `resources/skills` 回退目录和
`~/.floatnote/skills` 读取，返回 `name`、`description`、`displayName`、
`displayDescription`、`source` 与 `enabled`。前两个字段是稳定英文运行时元数据；
后两个字段读取 `SKILL.md` 的 `metadata.floatnote-display-name` 与
`metadata.floatnote-short-description`，缺失时分别回退到前两个字段，
因此不依赖 sidecar 在线状态。内置目录还受当前内置 Skill ID 清单约束，陈旧的
打包资源目录不会重新进入目录清单或下发给 sidecar；debug 构建优先读取源码
`resources/skills`，不使用 `target` 中可能残留的资源副本。导入只接受根部含精确
`SKILL.md` 的目录，校验
元数据和重名后递归复制整个目录；符号链接被拒绝，复制先写临时目录再原子重命名。
启停状态先写 `disabled_skills`，sidecar 重载只是随后发生的运行时同步。

`Config` 不再包含应用主题或界面字号字段。Serde 会忽略旧配置中的 `theme` 与
`font_size`，后续原子保存自然清除遗留键，不需要破坏性迁移。
