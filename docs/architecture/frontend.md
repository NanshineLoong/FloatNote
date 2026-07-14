# 前端

FloatNote 使用 Vite 多页面应用：根目录 HTML 是各 WebView 入口。`src/note/main.ts` 只启动笔记窗口；`src/note/note-app.ts` 组装笔记编辑器、项目/文档切换、保存、watcher、助手和窗口事件。

## 边界

- `src/platform/` 是共享 agent/chat invoke/event gateway 与跨 feature DTO 所在处。feature 自己的窗口命令仍在相应 feature 内调用；跨 feature 合同应放在这里。
- `src/shared/` 放跨 feature 的 UI、Markdown、escape、快捷键和 toast；不能包含 feature 状态。
- `src/styles/` 是设计系统 token 层（`primitives` → `semantic` → `base`/`components`，由 `index.css` 聚合并被四个窗口链入）；`src/shared/ui/` 放跨窗口共享组件（Button/Icon/Menu/Scrollbar/EmptyState）。详见 `docs/development/design-system.md`。
- `src/note/` 管理 CodeMirror 编辑、项目空间、任务、标签、图片与笔记窗口布局。
  Markdown 编辑器使用测量式选区层；live preview 只把独占整行的图片替换为
  figure widget，并以精确源码偏移定位工具栏写回。Tab/Shift+Tab 对多行及完整
  列表子树操作。
  `piece-switcher.ts` 同时管理版本菜单与预览操作条；`version-preview.ts` 只保存预览前正文的状态语义，CodeMirror 的只读切换由 `editor.ts` 提供。版本列表用主标题与小号时间元信息分层显示，普通版本不显示“手动”来源，AI 快照保留低调标识。
- `src/assistant/` 管理流式聊天、消息 reducer、渲染、技能和 mention 选择器；不得导入 `src/note/` 内部模块。assistant turn 是严格有序的 block 流，允许过程、文本、权限和错误多次交错；工具状态用稳定 `callId` 更新，不能用“最近一个工具”推断。
- `src/history/`、`src/popup/`、`src/settings/` 分别是历史、选中文本弹窗和设置窗口的 UI。

设置窗口由 `src/settings/main.ts` 装配，`shell.ts` 管理原生标题栏下的侧栏与分类
切换，`general.ts` 只管理开机启动，`skills.ts` 管理目录清单、启停与导入，
`shortcuts.ts` 管理录制器、渐进披露和冲突反馈。模块通过 `Config` 与显式保存
回调协作，不跨模块查询 DOM。AI 提供商仍由 `provider-settings.ts` 管理六个固定档案。
列表采用单列行内展开，一次只编辑一家；输入先保存在本地草稿，只有字段合法且
发生变化时才允许显式保存。启用开关与展开状态独立，未保存 API Key 与模型的
档案不可启用，Base URL 只对 OpenAI、Anthropic 与阿里云百炼显示。

外观仅跟随操作系统。`Config` DTO 不含 `theme` 或 `font_size`，各窗口的
`initializeAppearance` 也不读取配置或订阅 appearance 事件；编辑器不再注册
Cmd/Ctrl 加减号的应用级字号调整链路。

`shared/note-logic/` 是前端和 sidecar 共享的 workspace package，只包含 Markdown block、标签模型与调色板等纯逻辑；它不依赖 DOM、Node I/O 或 Tauri API。

## 兼容入口

`src/note/agent.ts`、`chat-history.ts`、`chat-history-format.ts`、`inline.ts` 和 `tags/floating.ts` 是兼容 re-export。新跨 feature 调用应改用 `src/platform/` 或 `src/shared/` 的正式入口。
