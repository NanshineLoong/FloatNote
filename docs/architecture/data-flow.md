# 数据流

## 编辑与保存

笔记窗口从 feature 内的调用点（例如 `notes-state.ts`）调用 Rust command。共享的 agent/chat DTO 与事件入口位于 `src/platform/`。`notes-state.ts` 为每个路径维护防抖保存队列，并把上次读取的 mtime 作为写入前置条件。Rust 检查 mtime、原子写文件，并在写入前登记 watcher 自写抑制；外部变更再以事件返回 WebView。

项目窗口会把当前可编辑笔记注册给 Rust。项目空间中，inbox、tasks 和 piece 都通过同一笔记读写路径处理；独立 Markdown 文件不拥有项目 tasks 面板。

## 版本浏览与恢复

点击历史版本时，前端通过 `read_version` 读取快照，在原 CodeMirror 中切换为只读预览；前端保留进入预览前的正文，退出时原样恢复，不触发 autosave，也不创建版本。预览可连续切换多个历史版本，始终保留最初的可编辑正文作为恢复前内容。

用户明确选择“恢复此版本”后，前端先串行等待该路径正在进行的 autosave，并把仍待保存的当前内容写盘，再携带最新 mtime 调用 `restore_version`。Rust 在创建备份前校验 mtime，磁盘已被外部修改时拒绝覆盖；当前内容与目标快照不同时保存一个 `source=restore`、名称为“恢复前备份”的安全版本，然后原子写回目标内容，相同则不制造重复快照。版本行的重命名和删除分别通过独立 command 更新 manifest 或移除对应快照；manifest 先安全替换，删除失败时保留或回滚版本索引，避免先丢快照内容。

## AI 对话与编辑

```text
Assistant UI → src/platform/agent → Tauri command → Rust agent host
                                                    ↕ JSONL
                                              Node sidecar
```

sidecar 将流式对话事件输出到 JSONL；Rust 解析并广播为 `agent://event`，由 `src/platform/agent.ts` 订阅。工具事件携带稳定 `callId`、安全显示标题、状态和可选短错误，使前端能按真实调用匹配交错执行；原始参数和工具返回正文不进入 UI 协议。写工具发起 `apply_edit` 时同时携带 Pi 的 `toolCallId`，Rust 将它透传到 `permission://request`，因此权限卡能原位升级正确的工具块。编辑不会立即落盘：Rust 解析 target、保存 pending edit；用户在 UI 中 allow 或 deny 后，`resolve_permission` 才完成写入并向 sidecar 回传结果。

turn 结束事件包含 `completed`、`cancelled` 或 `failed` outcome。取消时前端保留已有
部分输出并显示“已中断”；无输出取消也不会进入空响应错误分支。模型失败显示清理
后的实际错误，空响应提示只用于正常完成却没有任何可见输出的 turn。

Pi session JSONL 是完整会话事实源；`chat-history/index.json` 只保存列表元数据、正文摘要和工具摘要。打开会话时 sidecar 从活动分支恢复有序 thinking/text/tool blocks，前端始终保存这份完整状态，再按 `assistant_output_mode` 做 compact/detailed 投影。设置保存成功后 Rust 广播 `assistant-output-mode-changed`，已打开笔记窗口立即重投影，不重新请求模型或改写 session。

重试或编辑历史用户回合是一次 session 分支操作：前端先发 `agent_rewind`，sidecar 将活动 session 叶节点退回到目标用户回合之前；回退成功后前端删除该回合之后的显示消息并发送新 prompt。旧分支不再进入模型上下文，新的完成回合以 `session_synced` 刷新 Rust 的持久化历史索引。

`list_notes` 由 sidecar 请求 Rust 根据当前 active project 动态枚举；具体文件名不注入 system prompt。`create_note` 使用独立 JSONL 请求，但复用同一 permission queue：确认后 Rust 再次校验 piece 文件名与同名冲突，随后原子创建。网络研究由 sidecar 的 `web_search` / `web_fetch` 直接完成，只读过程通过普通 tool start/end 卡展示，不进入本地写权限流程。

## AI 提供商保存与切换

```text
设置页草稿 → save_ai_provider / set_active_ai_provider
            → Rust 获取全局 Config 写事务锁，校验并构造候选配置
            → configure(callId) → sidecar 构建候选 PI model
            ← configure_result(callId, ok/error)
            → 成功后以临时文件替换方式持久化 ai_settings 并更新内存状态
```

保存非当前档案不触碰 sidecar。保存当前档案或启用另一家时，sidecar 接受候选后
Rust 才持久化，因此失败不会关闭或覆盖原提供商；sidecar 会先为已打开对话重建
候选会话并整体提交。持久化失败时 Rust 重新下发旧 profile；若此前没有 active
profile，则通过 `clear_configuration` 恢复未配置运行态。关闭当前提供商只持久化
`activeProviderId: null`，随后 `agent_send` 在
host 边界返回“尚未启用 AI 提供商”，不会把 prompt 交给残留运行会话。
成功启用或更新当前提供商后，Rust 广播 `agent://configuration-changed`；助手会重新
打开此前因未配置而失败的活动会话，成功的 `session_opened` 会替换旧配置错误气泡。

应用启动时，sidecar 的配置栅栏默认关闭。Rust 收到 transport `ready` 后，有活动
提供商则下发启动 `configure`，否则下发 `configuration_ready`；先到达的会话恢复
命令会在栅栏后等待，因此 transport ready 不再被误当作模型已经配置完成。

## 全局划词弹窗

```text
CGEvent mouse down/up
  → dedicated listen-only event-tap thread（callback 仅投递元数据）
  → selection_intent worker（拖选/原生双击/原生三击候选）
  → capture（AX focused/children/ancestors → 本地快照或外部剪贴板兜底）
  → NSPasteboard 全 item/type 恢复；文本相符时附加 HTML
  → popup cache（generationId）
  → selection-popup WebView（测量 → resize → clamp/place → 不主动聚焦 show）
  → submit_popup_capture
  → quote-captured → inbox editor
```

新鼠标按下会使上一候选失效；抓取前后都检查原生事件代次。event tap 始终
listen-only：按键和外部点击可异步关闭弹窗，但事件继续传给来源应用。显示
路径不调用窗口 `set_focus()`，用户首次点击弹窗时才允许窗口获得焦点。

## 打包时的 AI 启动

开发构建用 sidecar 的本地 `tsx` 启动 `src/main.ts`。发布构建由 Tauri 启动随应用打包的 Node external binary，并把 ESM sidecar bundle 作为第一个参数，因此运行时不依赖用户 PATH、全局 Node 或源码目录。
