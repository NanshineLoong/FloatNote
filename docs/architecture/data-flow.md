# 数据流

## 编辑与保存

笔记窗口从 feature 内的调用点（例如 `notes-state.ts`）调用 Rust command。共享的 agent/chat DTO 与事件入口位于 `src/platform/`。`notes-state.ts` 为每个路径维护防抖保存队列，并把上次读取的 mtime 作为写入前置条件。Rust 检查 mtime、原子写文件，并在写入前登记 watcher 自写抑制；外部变更再以事件返回 WebView。

项目窗口会把当前可编辑笔记注册给 Rust。项目空间中，inbox、tasks 和 piece 都通过同一笔记读写路径处理；独立 Markdown 文件不拥有项目 tasks 面板。

## AI 对话与编辑

```text
Assistant UI → src/platform/agent → Tauri command → Rust agent host
                                                    ↕ JSONL
                                              Node sidecar
```

sidecar 将流式对话事件输出到 JSONL；Rust 解析并广播为 `agent://event`，由 `src/platform/agent.ts` 订阅。工具事件携带稳定 `callId`，start 还携带参数摘要，end 携带结果和错误标记，使前端能按真实调用匹配交错执行并展示操作对象。写工具发起 `apply_edit` 时同时携带 Pi 的 `toolCallId`，Rust 将它透传到 `permission://request`，因此权限卡能原位升级正确的工具块。编辑不会立即落盘：Rust 解析 target、保存 pending edit；用户在 UI 中 allow 或 deny 后，`resolve_permission` 才完成写入并向 sidecar 回传结果。

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
