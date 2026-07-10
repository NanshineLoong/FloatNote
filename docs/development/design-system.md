# 设计系统（Design System）

FloatNote 前端采用纯 CSS 自定义属性（不使用 Tailwind/Radix 等框架）建立三层 token 体系，并由 `src/shared/ui/` 提供跨窗口共享组件。本文是配色、间距、字号、交互状态与组件类名的单一事实来源。

## Token 三层架构

```
Primitive（原始值）  →  Semantic（语义别名）  →  Component（组件）
src/styles/primitives.css   src/styles/semantic.css   src/styles/components.css
```

- **Primitive**：色阶（indigo、中性灰）、tag 调色板（仅文档/可追溯，源在 `shared/note-logic/.../palette.ts`）、danger/success、motion、基础 radius。组件**不直接**消费。
- **Semantic**：`--color-surface*` / `--color-text*` / `--color-border*` / `--color-accent*` / `--color-hover` / `--color-selected` / `--color-focus-ring` / `--shadow-*` / `--radius-*` / `--space-*` / `--font-*` / `--fs-*`，并在 `@media (prefers-color-scheme: dark)` 内重定义。组件与窗口样式引用这些。
- **Component**：`.fn-*` 共享组件样式（见下）。

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

## 交互状态（在 `base.css`）

- **focus**：全局 `:where(button,a,input,select,textarea,[tabindex]):focus-visible` → `outline: 2px solid var(--color-accent)` + `box-shadow: 0 0 0 4px var(--color-focus-ring)`。修复了此前仅 history 有 focus 环的可达性缺口。组件**不得**覆盖 `outline`。
- **hover**：`--color-hover`（ghost）/ `--color-accent-hover`（primary）。
- **selected/active**：`.is-on { background: var(--color-selected); color: var(--color-accent) }`。
- **disabled**：`opacity: .4; cursor: default`。
- **reduced-motion**：全局统一（此前仅 styles/assistant/popup 有）。

## 边框宽度

两套边框**未强行统一**，仅命名：`--fn-border-width`(1px，菜单/输入/设置/历史) 与 `--fn-border-hair`(0.5px，助手/浮层 macOS 发丝线)。强制统一会改变助手发丝线视觉。

## 共享组件（`src/shared/ui/`，`fn-` 前缀）

| 组件 | 文件 | 类名 | 合并的旧重复 |
|---|---|---|---|
| Button | `button.ts` | `.fn-btn[--primary/--secondary/--ghost/--danger/--sm/--icon]`、`.is-on/:disabled` | `.icon-btn`、`.popup-btn*`、`.settings-btn-*`、`.history-icon-btn`、`.empty-state-btn` |
| Icon | `icon.ts` | `.fn-icon` | Phosphor 字形 + `action-card.ts` 内联 SVG |
| Menu | `menu.ts` | `.fn-menu[__item/--danger/__separator/__submenu]` | `floating-menu.ts` + `dock-dropdown.ts` + `project-menu-render.ts` 子菜单 |
| Modal | `modal.ts` | `.fn-modal[__backdrop/__dialog/__header/__body/__footer]` | 净新增（原生 Tauri confirm 保留用于 OS 级确认） |
| Scrollbar | `scrollbar.ts` | `.fn-scroll__thumb[.is-visible]` | 原 note-only `.scroll-thumb`，推广到 history/assistant |
| EmptyState | `empty-state.ts` | `.fn-empty*`（旧 `.empty-state-*` 暂保留别名） | `popup.html` 手写 `#popup-empty` |

组件本轮可先不接线；窗口样式按 Phase C 增量迁移到 `fn-` 类与 token。`src/note/empty-state.ts`、`src/note/scrollbar.ts` 已改为 `src/shared/ui/` 的 re-export，调用方不变。

## 迁移状态

- ✅ token 地基 + `index.css` 载入 + 起步组件 + 主色 hex（`#2563eb`/`#60a5fa`/`#1d4ed8`/`#3b82f6`）→ token + popup 别名 + 滚动条统一 + CM 主题桥接。
- ⏳ 后续：逐调用点切到 `createButton`/`createIcon`/`createMenu`/`openModal`；剩余 accent rgba 色阶（hover/选中/焦点环的 `rgba(37,99,235,*)`、`rgba(96,165,250,*)`、`rgba(59,130,246,*)`）按语义映射到 `--color-hover`/`--color-selected`/`--color-focus-ring`；窗口级 `.switch-menu`/`.popup-btn` 等迁移到 `.fn-*`。

## 跨平台注记

`-apple-system`/`SF Pro Text` 在 Windows 降级为 `system-ui`（可接受）；0.5px 发丝边在非 retina Windows 可能渲染为 1px；focus 环（outline + box-shadow 组合）在 Windows Chromium 可能更重。改到这些区域时须在 macOS 与 Windows 各验证一遍（见 `docs/development/cross-platform.md`）。
