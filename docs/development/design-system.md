# 设计系统（Design System）

FloatNote 前端采用纯 CSS 自定义属性（不使用 Tailwind/Radix 等框架）建立三层 token 体系，并由 `src/shared/ui/` 提供跨窗口共享组件。本文是配色、间距、字号、交互状态与组件类名的单一事实来源。

## Token 三层架构

```
Primitive（原始值）  →  Semantic（语义别名）  →  Component（组件）
src/styles/primitives.css   src/styles/semantic.css   src/styles/components.css
```

- **Primitive**：色阶（indigo、中性灰）、tag 调色板（仅文档/可追溯，源在 `shared/note-logic/.../palette.ts`）、danger/success、motion、基础 radius。组件**不直接**消费。
- **Semantic**：`--color-surface*` / `--color-text*` / `--color-border*` / `--color-accent*` / `--color-hover` / `--color-selected` / `--color-focus-ring` / `--color-focus-scrim` / `--shadow-*` / `--radius-*` / `--space-*` / `--font-*` / `--fs-*`，并在 `@media (prefers-color-scheme: dark)` 内重定义。组件与窗口样式引用这些。
- **Component**：`.fn-*` 共享组件样式，以及设置窗口使用的
  `--settings-shell-surface` / `--settings-canvas-surface` /
  `--settings-card-*` / `--settings-control-height` / `--settings-row-padding`
  组件 token（见下）。

四个文件由 `src/styles/index.css` 聚合（**保持 import-only**：CSS 规范要求 `@import` 在前，混入普通规则会导致构建静默丢弃 import）。

## 主色与暗色模式

- **主色 = 墨蓝 Indigo**：浅 `#4F46E5`（`--indigo-600`）、深 `#818CF8`（`--indigo-400`），hover `#4338CA`/`#A5B4FC`，pressed `#3730A3`。经 `--color-accent` 等语义 token 贯穿按钮/选中/焦点环/链接。
- Indigo **不在 tag 调色板**中，故主操作不会与标签 chip 混淆。
- **暗色仅跟随系统** `@media (prefers-color-scheme: dark)`，本轮无应用内主题切换、无 Rust 配置字段。
- CodeMirror 主题（`src/note/preview/builder.ts`）无法运行时读 CSS 变量，经 `src/styles/accent.ts` 常量桥接（单一来源，与 `primitives.css` 同步）。

## 载入契约

`index.html` / `settings.html` / `popup.html` / `history.html` 各在 `<head>` 链入 `/src/styles/index.css`，再链各自窗口样式。`src/note/preview/builder.ts` 的 CM 主题与 `src/shared/toast.ts` 是例外：toast 仍按文档自注入 `<style>`（早于全局层的历史遗留）。

`src/styles/tokens.test.ts` 守卫：断言 indigo 色阶完整、语义 token 存在、tokenized CSS 中无残留 `#2563eb`、四个 HTML 均链入 `index.css`、`index.css` 仅含 `@import`。

## 间距 / 字号 / 圆角 / 阴影

- 间距：`--space-1`(4) … `--space-8`(24)。
- 字号：`--fs-xs`(11) / `--fs-sm`(12) / `--fs-base`(13) / `--fs-md`(14) / `--fs-lg`(15，编辑器)。字重 `--fw-regular/medium/semibold`。字体栈 `--font-sans` / `--font-mono`。
- 圆角：`--radius-xs`(3) / `--sm`(6) / `--md`(8) / `--lg`(10) / `--radius-full`(9999)。
- 阴影：`--shadow-xs … --shadow-xl`（暗色已重定义更深）。
- 划词弹窗关闭原生窗口阴影，由唯一的 CSS 工具条容器持有发丝边与
  `--shadow-sm`；Tauri 窗口按内容动态测量，只保留 6px 阴影余量，避免透明
  原生边界与可见内容错位。

## 交互状态（在 `base.css`）

- **focus**：全局 `:where(button,a,input,select,textarea,[tabindex]):focus-visible` → `outline: 2px solid var(--color-accent)` + `box-shadow: 0 0 0 4px var(--color-focus-ring)`。修复了此前仅 history 有 focus 环的可达性缺口。组件**不得**覆盖 `outline`。
- 助手紧凑输入器的 CodeMirror 根节点不是原生表单控件，且外层展开动画会裁剪外描边；因此由静态组件 CSS 持有 18px 圆角与 `--fn-border-width` 常驻边框，聚焦时用 accent 向内描边，避免 WebKit 绘制矩形 outline。只有进入聚焦纸张后才移除这层输入器 chrome。
- **hover**：`--color-hover`（ghost）/ `--color-accent-hover`（primary）。
- **selected/active**：`.is-on { background: var(--color-selected); color: var(--color-accent) }`。
- **disabled**：`opacity: .4; cursor: default`。
- **reduced-motion**：全局统一（此前仅 styles/assistant/popup 有）。

## 边框宽度

两套边框**未强行统一**，仅命名：`--fn-border-width`(1px，菜单/输入/设置/历史，包括助手紧凑输入器) 与 `--fn-border-hair`(0.5px，助手卡片/浮层 macOS 发丝线)。强制统一会改变助手发丝线视觉。

## 助手聚焦纸张

长输入使用 `body` 顶层 `.fn-input-overlay`，遮罩消费
`--color-focus-scrim`，纸张消费 `--color-surface` 与 `--shadow-xl`。纸张宽高分别为
`min(920px, calc(100vw - 32px))` 和
`min(720px, calc(100vh - 64px))`；内容 padding 用 `clamp()` 连续变化。
聚焦态的 CodeMirror 根节点、滚动区与内容区不再绘制独立边框、背景或圆角，正文
行内边距同时约束文本和选区，顶部与底部分别留出关闭、发送按钮安全区。关闭与
发送按钮的命中区均为 44px；聚焦态 Enter 只换行，发送只能点击右下角按钮。
候选 popover 位于聚焦层之上，toast 再位于两者之上；动画遵循
`prefers-reduced-motion`。

## 共享组件（`src/shared/ui/`，`fn-` 前缀）

| 组件 | 文件 | 类名 | 合并的旧重复 |
|---|---|---|---|
| Button | `button.ts` | `.fn-btn[--primary/--secondary/--ghost/--danger/--sm/--icon]`、`.is-on/:disabled` | `.icon-btn`、`.popup-btn*`、`.settings-btn-*`、`.history-icon-btn`、`.empty-state-btn` |
| Icon | `icon.ts` | `.fn-icon` | Phosphor 字形 + `action-card.ts` 内联 SVG |
| Menu | `menu.ts` | `.fn-menu[__item/--danger/__separator/__submenu]` | `floating-menu.ts` + block 操作菜单 + `project-menu-render.ts` 子菜单 |
| Popover | `components.css` | `.fn-popover` | assistant history / skill / mention 下拉的共同表面 |
| Scrollbar | `scrollbar.ts` | `.fn-scroll__thumb[.is-visible]` | 原 note-only `.scroll-thumb`，推广到 history/assistant |
| Form control | `components.css` | `.fn-control` | settings 的 text/password/select 与 assistant 输入框 |
| EmptyState | `empty-state.ts` | `.fn-empty*` + `.fn-btn*` actions | 笔记窗口全页 `NO_PROJECT` / `PATH_ERROR` / `NO_PIECE` |

设置窗口采用不透明内容画布与柔和描边卡片。标题栏和侧栏可以消费外壳表面
token，内容卡片只消费 settings component token，不直接读取 primitive。原生
`select` 保留键盘与系统语义，通过 `.select-wrap` 统一单箭头、高度和状态；开关
继续由原生 checkbox 承载状态，并把 label 点击区扩展到至少 44px。快捷键录制器
使用 `recording` / `has-value` / `has-error` 状态，所有动画服从全局 reduced-motion。

组件按阶段增量接线：Phase 0 修组件（`createButton` iconOnly、`createMenu` 子菜单 Escape/焦点/互斥单浮层）→ icon → button → menu。窗口样式迁移到 `fn-` 类与 token。`src/note/empty-state.ts`、`src/note/scrollbar.ts` 已改为 `src/shared/ui/` 的 re-export，调用方不变。OS 级确认继续用原生 Tauri `confirm`（`notes-state.ts`），不引入 in-DOM modal。

## 迁移状态

- ✅ token 地基 + `index.css` 载入 + 起步组件 + 主色 hex（`#2563eb`/`#60a5fa`/`#1d4ed8`/`#3b82f6`）→ token + popup 别名 + 滚动条统一 + CM 主题桥接。
- ✅ 窗口样式全量对齐 popup 模板：accent rgba 色阶（hover/选中/焦点环）→ `--color-hover`/`--color-selected`/`--color-focus-ring`/`--color-accent-fill`；中性 hex → `--color-surface*`/`--color-text*`/`--color-border*`；各窗口 `@media (prefers-color-scheme: dark)` 块与窗口级 reset 删除，dark 统一由 `semantic.css` 兜底；`base.css` 上移 `body` 背景色与 `button/input` 字体继承。`accent.ts` 常量桥接保留（CM 静态编译限制）。
- ✅ 新增 danger 语义 token 组（`--color-danger`/`--color-danger-hover`/`--color-danger-fill`/`--color-danger-fill-strong`，light+dark，与 accent 对称）+ `--color-success` + chat 气泡 token（`--color-bubble-user-*`/`--color-bubble-ai-bg`）。`primitives.css` 补 `--danger-400`。`components.css` 的 `.fn-btn--danger`/`.fn-menu__item--danger` 改用语义 token。
- ✅ 历史窗口：工具栏/删除/加载更多切到 `createButton`，清理时间菜单切到 `createMenu`；移除 `.history-icon-btn` / `.history-clear-options` 重复样式。
- ✅ 弹窗：采集操作切到 `createButton`，移除 `.popup-btn*` 手写按钮体系。
- ✅ 设置与助手：设置页原生 text/password/select、助手输入框切到 `.fn-control`；助手的新对话与历史入口切到 `createButton`。
- ✅ 设置窗口成为第一套完整迁移样板：原生平台外壳、侧栏导航、不透明卡片、
  内缩分隔线、统一 select/switch/recorder/error 状态均由现有三层 token 驱动。
- ✅ 阶段二（第一批）：笔记窗口的项目/成品/版本/标签/块操作菜单统一 `.fn-menu` / `.fn-menu__item`；全页 EmptyState 统一 `.fn-empty*` 与 `.fn-btn*` actions；assistant 的 history / skill / mention 下拉复用 `.fn-popover` 表面。`createMenu` 外点监听修复为在子菜单交互后仍保持有效，并有回归测试。
- ⏳ 后续：继续逐调用点切到 `createButton`/`createIcon`，重点收敛笔记窗口遗留 `.icon-btn`；任务面板菜单与编辑器专属控件需保留其定位、拖拽或 CodeMirror 交互，再按行为抽取。
- 守卫：`src/styles/tokens.test.ts` 断言窗口 CSS 无残留 accent/danger rgba、无 per-window dark `@media` 块、danger 语义 token 存在、组件层不裸用 primitives。

## 跨平台注记

`-apple-system`/`SF Pro Text` 在 Windows 降级为 `system-ui`（可接受）；0.5px 发丝边在非 retina Windows 可能渲染为 1px；focus 环（outline + box-shadow 组合）在 Windows Chromium 可能更重。改到这些区域时须在 macOS 与 Windows 各验证一遍（见 `docs/development/cross-platform.md`）。
