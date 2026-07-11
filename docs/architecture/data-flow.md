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

sidecar 将流式对话事件输出到 JSONL；Rust 解析并广播为 `agent://event`，由 `src/platform/agent.ts` 订阅。读取和编辑工具同样经 JSONL 回到 Rust。编辑不会立即落盘：Rust 解析 target、保存 pending edit、发送 `permission://request`；用户在 UI 中 allow 或 deny 后，`resolve_permission` 才完成写入并向 sidecar 回传结果。

## 全局划词弹窗

```text
CGEvent mouse down/up
  → selection_intent（拖选/原生双击/原生三击候选）
  → selection_probe（同一前台应用 + 文本 AX role + 非空选区）
  → capture（保留并恢复剪贴板，读取 text/html）
  → popup cache（generationId）
  → selection-popup WebView（测量 → resize → clamp/place → 无焦点 show）
  → submit_popup_capture
  → quote-captured → inbox editor
```

新鼠标按下会使上一候选失效；抓取前后都检查原生事件代次。弹窗可见时，
Esc 由全局 event tap 消费并关闭，外部点击只关闭弹窗但继续传给来源应用。
显示和提交路径都不调用窗口 `set_focus()`。

## 打包时的 AI 启动

开发构建用 sidecar 的本地 `tsx` 启动 `src/main.ts`。发布构建由 Tauri 启动随应用打包的 Node external binary，并把 ESM sidecar bundle 作为第一个参数，因此运行时不依赖用户 PATH、全局 Node 或源码目录。
