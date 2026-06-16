# Sprint 4 — 助手 UI + 双窗口模式 Implementation Plan


**Goal:** 实现参考图样式的 AI 助手界面（聊天气泡、输入框、流式渲染、工具调用提示），并实现"分离/嵌入"双模式：默认独立窗口吸附在笔记窗右侧，右上角胶囊可折叠/切换，全屏时自动切为笔记窗内右侧栏。

**Architecture:** 助手 UI 抽成与挂载点无关的模块 `src/assistant/`（一个 `mountAssistant(root, deps)` 函数）。它在两处被挂载：① 新 Vite 入口 `assistant.html`（独立窗口 webview "assistant"）；② 笔记窗内的 `#assistant-pane`（嵌入模式）。两处都通过 Sprint 3 的 `agentSend` + `onAgentEvent` 工作（状态源在 Rust，故两视图天然一致）。Rust 侧 `windows.rs` 增加 assistant 窗的创建/吸附/全屏监听与模式切换。

**Tech Stack:** TypeScript + Vite 多入口、Tauri 窗口 API（position/size/事件/全屏）、CSS。

---

## 文件结构

- Create: `assistant.html` — 第三个 Vite 入口
- Modify: `vite.config.ts:8-13` — rollupOptions.input 加 `assistant`
- Create: `src/assistant/main.ts` — 独立窗口入口，调用 `mountAssistant`
- Create: `src/assistant/assistant.ts` — `mountAssistant(root, deps)`：渲染 + 事件订阅 + 发送
- Create: `src/assistant/render.ts` — 纯函数：消息列表 → DOM 片段；流式 delta 合并逻辑
- Create: `src/assistant/render.test.ts` — 纯逻辑单测
- Create: `src/assistant/styles.css` — 助手样式（气泡/输入框/工具提示）
- Modify: `src/note/main.ts` — 嵌入 pane 容器 + 胶囊按钮 + 模式切换 + 监听 `note://updated`
- Modify: `src/note/topbar.ts` — 右上角胶囊按钮
- Create: `src-tauri/src/assistant_window.rs`（或并入 `windows.rs`）— assistant 窗创建/吸附/全屏监听/模式命令
- Modify: `src-tauri/src/windows.rs` / `lib.rs` / `commands.rs` — 接线
- Modify: `src-tauri/tauri.conf.json` — 声明 assistant 窗（默认隐藏、无边框可选）
- Modify: `src-tauri/src/config.rs` — 持久化 `assistant_mode`（"detached"|"embedded"）与折叠状态

---

## Task 1: 助手渲染纯逻辑（TDD）

- [ ] `render.test.ts`：测一个 `reduceEvents(state, event)` 状态机——`delta` 累加进"当前 assistant 气泡"；`done` 收尾该气泡；`tool start/end` 产出一条"AI 正在整理笔记…"占位并在 end 移除；用户发送追加 user 气泡。给出多用例。
- [ ] 实现 `render.ts`（`ChatState`、`reduceEvents`、`renderMessages(state)→HTMLElement`）。
- [ ] 提交：`feat(assistant): chat state reducer + render (tested)`。

## Task 2: mountAssistant + 样式

- [ ] `assistant.ts`：`mountAssistant(root, { send, subscribe })`：渲染消息区 + 底部 dock（机器人头像 `robot.svg` + 按需展开的输入框）；订阅事件经 `reduceEvents` 更新；发送时调 `send(text)`。`deps` 注入便于两个挂载点共用、便于测试。
- [ ] **输入框按需展开**：默认 dock 只有机器人头像，输入框 `max-width:0; opacity:0`（DOM 存在但收起）。点击头像 toggle：展开（`max-width` 0→满 + 淡入 + 轻微 translateX，约 340ms `cubic-bezier(.22,1,.36,1)`），机器人轻微缩放应答，展开后 focus 输入框；再次点击收起。Enter 发送、Shift+Enter 换行。展开/收起为纯 CSS class 切换，状态在模块内。
- [ ] `styles.css`：AI 气泡纯白（白底 + 0.5px 边、左对齐、左下小尖角）；用户气泡单一浅蓝色调（右对齐）；底部 dock 圆角输入框 + 机器人头像；与 `src/styles.css` 变量协调。用 `frontend-design` 技能产出高质量样式。视觉/动画基准为已确认的 mockup（`floatnote_assistant_panel_reveal`）。
- [ ] 提交：`feat(assistant): mountable assistant component + styles`。

## Task 3: 独立窗口入口

- [ ] `assistant.html` + `src/assistant/main.ts`：构造 `deps`（`send` = 用当前活动笔记调 `agentSend`；`subscribe` = `onAgentEvent`），`mountAssistant(document body root)`。活动笔记信息从 Rust 查询命令或启动参数取（新增 `get_active_note` 命令，返回 state.active_note）。
- [ ] `vite.config.ts` input 加 `assistant: resolve(__dirname, "assistant.html")`。
- [ ] `tauri.conf.json`：新增 window `"assistant"`，`"visible": false`，`"url": "assistant.html"`，尺寸/装饰参考图（无系统标题栏、可圆角）。
- [ ] `npm run build` 通过（三入口）。
- [ ] 提交：`feat(assistant): standalone assistant window entry`。

## Task 4: 嵌入模式挂载

- [ ] `src/note/main.ts`：`app.innerHTML` 改为 `[左:笔记列] [右:#assistant-pane]` 布局（flex）；当模式=embedded 时 `mountAssistant(#assistant-pane, deps)` 并显示该列、隐藏 assistant 窗；mode=detached 时隐藏该列、显示 assistant 窗。
- [ ] 监听 `note://updated`：用 `setDoc` 热刷新编辑器、刷新版本条（与外部覆盖一致）。注意避免和本地 autosave 互相打架（更新来自 AI 时直接覆盖编辑器内容）。
- [ ] 提交：`feat(assistant): embedded pane in note window`。

## Task 5: 顶栏 robot_icon 开关 + 模式切换 + 吸附

- [ ] `topbar.ts`：在顶栏最右侧（红绿灯系统按钮那一行的最右）加 `robot_icon.svg` 按钮——开/关整个助手（显示/隐藏分离窗或嵌入栏）。长按/右键或单独的小切换控件用于切换分离/嵌入模式（保持简洁，主功能是开关）。回调进 `main.ts`。
- [ ] 新命令 `set_assistant_mode(mode)` / `toggle_assistant()`：Rust 据此显隐 assistant 窗或嵌入列，并存 `config.assistant_mode`。
- [ ] `assistant_window.rs`：detached 时监听笔记窗 `Moved`/`Resized` 事件，把 assistant 窗 position 设为笔记窗右缘（吸附）；初始定位同理。
- [ ] 提交：`feat(assistant): capsule toggle + mode switch + docking`。

## Task 6: 全屏自动切换

- [ ] 监听笔记窗全屏/Space 变化（macOS：`WindowEvent` 或 `tauri` 全屏 API 轮询；Windows：最大化/全屏判断）。进入全屏 → 强制 embedded 并隐藏 assistant 窗；退出 → 恢复用户上次选择的 mode。
- [ ] 平台分支：用 `#[cfg(target_os=...)]` 守卫平台特定全屏检测。
- [ ] 手动验证两端（macOS 进入原生全屏自动变嵌入；Windows 最大化行为符合预期）。
- [ ] 提交：`feat(assistant): auto-embed on fullscreen`。

---

## 验收清单（Sprint 4 Done）

- [ ] `npm test` 全绿（render reducer）、`npm run build` 通过（三入口）
- [ ] 分离模式：assistant 窗吸附在笔记窗右侧，随笔记窗移动跟随
- [ ] 胶囊按钮可折叠/展开、可在分离/嵌入间切换，状态重启后保留
- [ ] 全屏：自动切嵌入栏；退出全屏恢复
- [ ] 发消息能流式渲染；AI 改写时编辑器热更新 + 版本条出现新 AI 版本
- [ ] 视觉接近 `docs/refer_frontend.png`
- [ ] macOS 与 Windows 各手验一遍模式切换
