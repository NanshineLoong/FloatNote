# 前端

FloatNote 使用 Vite 多页面应用：根目录 HTML 是各 WebView 入口。`src/note/main.ts` 只启动笔记窗口；`src/note/note-app.ts` 组装笔记编辑器、项目/文档切换、保存、watcher、助手和窗口事件。

## 边界

- `src/platform/` 是共享 agent/chat invoke/event gateway 与跨 feature DTO 所在处。feature 自己的窗口命令仍在相应 feature 内调用；跨 feature 合同应放在这里。
- `src/shared/` 放跨 feature 的 UI、Markdown、escape、快捷键和 toast；不能包含 feature 状态。
- `src/styles/` 是设计系统 token 层（`primitives` → `semantic` → `base`/`components`，由 `index.css` 聚合并被四个窗口链入）；`src/shared/ui/` 放跨窗口共享组件（Button/Icon/Menu/Modal/Scrollbar/EmptyState）。详见 `docs/development/design-system.md`。
- `src/note/` 管理 CodeMirror 编辑、项目空间、任务、标签、图片与笔记窗口布局。
- `src/assistant/` 管理流式聊天、消息 reducer、渲染、技能和 mention 选择器；不得导入 `src/note/` 内部模块。
- `src/history/`、`src/popup/`、`src/settings/` 分别是历史、选中文本弹窗和设置窗口的 UI。

`shared/note-logic/` 是前端和 sidecar 共享的 workspace package，只包含 Markdown block、标签模型与调色板等纯逻辑；它不依赖 DOM、Node I/O 或 Tauri API。

## 兼容入口

`src/note/agent.ts`、`chat-history.ts`、`chat-history-format.ts`、`inline.ts` 和 `tags/floating.ts` 是兼容 re-export。新跨 feature 调用应改用 `src/platform/` 或 `src/shared/` 的正式入口。
