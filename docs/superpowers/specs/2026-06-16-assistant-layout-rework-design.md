# 助手布局重构 — 设计文档

日期：2026-06-16
状态：已与用户确认，待进入实现计划（writing-plans）
关联：本文档细化并修正 `2026-06-16-ai-tutor-notes-design.md` §7 与 Sprint 4
（`2026-06-16-sprint-4-assistant-ui.md`）落地后暴露的体验问题。

## 1. 背景与动机

Sprint 4 落地后，助手 UI 在实际运行中有四类问题：

1. **拖动跟随有延迟**：分离模式下，独立助手窗靠监听笔记窗 `Moved/Resized` 事件**事后**重新定位，拖动笔记窗时助手窗肉眼可见地「迟一拍跟上」。
2. **分离窗是一块灰色面板**：`.assistant` 有 `background:#f4f5f7` 实底，看起来像一块矩形面板，而非「悬浮气泡 + 机器人」；空隙也不能点穿到后面的应用。
3. **robot_icon 位置不对**：现在紧挨第二行的「新建笔记 +」按钮，应移到标题栏（第一行）最右端。
4. **嵌入模式像一个独立区域**：现在嵌入是「把笔记窗加宽 340px + 一条带左边框的灰栏」，与正文割裂；且嵌入/分离要手动切。期望是助手活在**笔记窗内部的右边距**里，随窗口宽度自动在「窗内右边距」与「窗外独立窗」之间切换。

本设计统一解决以上四点。核心是把「嵌入 vs 分离」从手动开关，改为**由窗口宽度驱动的分级响应式布局**，并辅以一个用户可手动切换的重叠区间。

## 2. 目标与非目标

**目标**

- 分离窗拖动**零延迟**跟随笔记窗。
- 分离窗**透明**，仅气泡/机器人/输入框不透明，空隙处鼠标穿透到后面应用。
- robot_icon 移到标题栏最右；标题栏与第二行 topbar 合并为「两行」结构。
- 助手默认活在笔记窗**内部右边距**；随窗口宽度按既定规则在窗内/窗外自动切换，重叠区可手动切。
- 笔记正文按**分级收缩**规则随窗口宽度变化。

**非目标（保持不变 / 不在本次范围）**

- 助手对话逻辑、流式渲染、版本库、sidecar、Pi 接入——均不动。
- 笔记窗本身**不**做透明（仅分离助手窗透明）。
- 不引入新的对话/工具能力。

## 3. 名词与默认参数

布局相关的可调参数（默认值，实现时可微调；集中放一个常量模块便于调参与测试）：

| 名称 | 含义 | 默认值 |
| --- | --- | --- |
| `TEXT` | 正文理想（最大）宽度 | 640px |
| `PAD` | 无助手时正文到窗口边的最小边距 | 28px |
| `A_PREF` | 助手理想宽度（宽区/嵌入舒适宽） | 340px |
| `A_MIN` | 助手可接受的最小嵌入宽度 | 280px |
| `GAP` | 正文与右侧助手之间的间隙 | 24px |
| `W_MIN` | 笔记窗最小内容宽度 | 360px |

「右边距」在嵌入态下 = `GAP + 助手宽度`；在分离/无助手态下 = `PAD`。
「左边距」始终是纯空白。

## 4. 架构总览

```
笔记窗 (index.html, webview "main")
  第一行＝标题栏：红绿灯(左) ……可拖拽…… robot_icon(最右)
  第二行＝topbar：folder / 笔记名 / +
  内容区：[左边距] [正文列 CodeMirror] [右边距(含嵌入助手挂载点)]
                                          └ #assistant-pane（嵌入时挂载同一份助手 UI）
独立助手窗 (assistant.html, webview "assistant", 透明, main 的子窗口)
        │  Tauri 命令/事件
Rust 后端（状态源）
  • assistant_window.rs：开关/placement 落地、子窗口 attach、独立窗显隐
  • config.rs：assistant_open + 重叠区粘性偏好 assistant_pref
```

- **布局真值在前端**：一个纯函数 `computeLayout` 决定边距、正文宽、助手 placement。前端把结果写成 CSS 变量；placement 变化时通过命令通知 Rust 显隐独立窗。
- **Rust 仍是开关/偏好状态源**：持久化「助手是否打开」与「重叠区用户偏好」。但**不再**靠加宽窗口来做嵌入。
- 助手 UI 仍是一份代码（`src/assistant/`），既挂载于 `#assistant-pane`（嵌入），也作为独立窗 `assistant.html`（分离）。

## 5. 分级响应式布局（纯函数）

### 5.1 行为规格（随内容宽度 W 从大到小）

1. **最宽**：左边距 = 右边距，二者都大；助手嵌在右边距内（`A_PREF`）。
2. 变窄：**先压左边距**，右边距、正文 `TEXT` 不变。
3. 左边距压到 `PAD`：**再压右边距/助手**（`A_PREF` → `A_MIN`），正文不变。
4. 右边距压到「装不下助手」：助手**弹出为独立窗**，窗内右边距退回 `PAD`。
5. 继续变窄：左右边距都为 `PAD` 后，**才压正文**（`TEXT` → 更小），直到 `W_MIN`。

### 5.2 三段式 + 双阈值（嵌入 / 分离）

以「嵌入态下右边距可用宽度」`R` 衡量：

- `R ≥ A_PREF` → **宽区**：强制 `embedded`，禁用手动切换（独立窗按钮无效/禁用）。
- `A_MIN ≤ R < A_PREF` → **重叠区**：`placement` = 用户粘性偏好 `assistant_pref`；可手动切换。
- `R < A_MIN` → **窄区**：强制 `detached`，窗内不留助手位。

**滞回/记忆规则**：

- 偏好 `assistant_pref ∈ {embedded, detached}` 持久化于 config，仅在重叠区生效。
- 仅当宽度**越界进入强制区**时自动改变实际 placement；从强制区回到重叠区**保持当前形态**，等用户手动调。
- 手动切换只在重叠区被接受；强制区内的切换请求忽略（控件呈禁用态）。

### 5.3 纯函数接口

```ts
interface LayoutParams { TEXT; PAD; A_PREF; A_MIN; GAP; W_MIN; }
type Placement = "embedded" | "detached";
interface LayoutInput {
  contentWidth: number;     // 笔记窗内容区宽度
  open: boolean;            // 助手是否打开
  pref: Placement;         // 重叠区粘性偏好
}
interface LayoutResult {
  leftMargin: number;
  rightMargin: number;     // 含助手或仅 PAD
  textWidth: number;
  placement: Placement;    // embedded → 挂 #assistant-pane；detached → 显示独立窗
  zone: "wide" | "overlap" | "narrow"; // 供 UI 决定切换控件是否可用
  canToggle: boolean;      // === (zone === "overlap")
}
function computeLayout(input: LayoutInput, p: LayoutParams): LayoutResult;
```

- 纯函数、无副作用 → 用 Vitest 覆盖各分支与边界（宽/重叠/窄三区、越界自动切、`open=false`）。
- `open=false` 时：无助手，左右边距对称收缩到 `PAD`，正文按 5.1 第 5 步压缩；`placement` 无意义（不显示助手）。

### 5.4 应用层

- 前端在 `ResizeObserver`（或窗口 resize）回调里取内容区宽度 → `computeLayout` → 写 CSS 变量 `--left-margin/--right-margin/--text-width`，并据 `placement` 挂/卸 `#assistant-pane`。
- `placement` 变化时调用命令 `set_assistant_placement(placement)`：Rust 据此 `show/hide` 独立助手窗（窄区/重叠选 detached 时显示；否则隐藏）。
- 笔记窗**不再**因嵌入而被加宽：删除 `assistant_window.rs` 中 `set_main_width`/`NOTE_WIDTH+PANE_WIDTH` 逻辑。

## 6. 分离窗透明 + 鼠标穿透

- `tauri.conf.json` 的 `assistant` 窗增加 `"transparent": true`（已 `decorations:false`）。
- `.assistant` 去掉 `background`；只有 `.chat-assistant/.chat-user/.assistant-input/.assistant-bot` 等元素有底色与阴影；根容器透明。
- **空隙穿透**：助手窗监听 `mousemove`，对指针位置做命中检测——
  - 命中不透明交互元素（气泡/机器人/输入框/发送键）→ `getCurrentWindow().setIgnoreCursorEvents(false)`；
  - 落在透明空隙 → `setIgnoreCursorEvents(true)`，点击穿透到后面应用。
  - 命中用 `document.elementFromPoint` 或给不透明元素统一类名后判断 `event.target`。
  - 进入/离开窗口（`mouseleave`）时复位为穿透，避免卡在「不穿透」。
- 平台校验：macOS 与 Windows 都支持 `setIgnoreCursorEvents`；透明窗在两端均需 `transparent:true`。写计划时用 Context7 核对 Tauri 2 该 API 签名与平台注意点。

## 7. 拖动零延迟跟随（子窗口）

- 把独立助手窗设为笔记窗的**原生子窗口**：macOS `NSWindow addChildWindow:`（Tauri 的父子/owner 窗 API），Windows owner 窗。子窗随父窗一起被 OS 移动 → 拖动零延迟。
- 仍保留 `Resized` 时按右缘吸附调整助手窗高度/横向位置（尺寸变化不一定靠子窗自动处理）；但**移动**交给 OS。
- 事件重定位逻辑保留为兜底（子窗 API 在某平台不可用时）。
- 写计划时用 Context7 核对 Tauri 2 设置父子窗口的确切 API（`set_parent` / `WebviewWindowBuilder::parent` / `owner`）及 macOS/Windows 行为差异。

## 8. 标题栏（两行结构）

- **第一行＝标题栏**：
  - macOS：main 窗 `titleBarStyle:"Overlay"` + `hiddenTitle:true`，让内容延伸进标题栏。红绿灯在左（系统绘制），中间留可拖拽空白（`-webkit-app-region`/Tauri 拖拽），**robot_icon 在最右**。
  - Windows：main 窗 `decorations:false` + 自绘窗口控制（最小化/关闭）；robot_icon 同样在最右。
  - `#[cfg(target_os=...)]` + CSS 分支处理两端差异。
- **第二行＝现有 topbar**：`folder / 笔记名 / +`；**移除** robot_icon（迁到第一行）、移除「已自动保存」等冗余字样。
- robot_icon 交互不变：单击开/关助手；Option+单击在**重叠区**切换 embedded/detached（强制区无效）。

## 9. Rust / 命令变化

- `config.rs`：保留 `assistant_open`；将 `assistant_mode`（"detached"/"embedded"）语义改为重叠区粘性偏好 `assistant_pref`（默认 `embedded`）。
- `assistant_window.rs`：
  - 删除加宽笔记窗逻辑（`set_main_width`、`NOTE_WIDTH+PANE_WIDTH`）。
  - 新增/改造命令 `set_assistant_placement(placement)`：仅负责独立窗 `show/hide` 与子窗 attach/吸附；嵌入与否由前端 CSS 决定。
  - `toggle_assistant()`：开/关助手（持久化 `assistant_open`）。
  - 子窗 attach 在独立窗创建/显示时建立；`Resized` 时调整助手窗尺寸与右缘吸附；移动靠子窗。
- 全屏：不再特判强制嵌入——全屏时窗口很宽、右边距充裕，自然落入「宽区」强制 embedded。移除 `fullscreen` 特例（或保留为「全屏即宽区」的简单守卫）。

## 10. 前端模块变化

- 新增 `src/note/layout.ts`：`computeLayout` 纯函数 + 默认参数常量。
- 新增 `src/note/layout.test.ts`：Vitest 覆盖三区、越界自动切、`open=false`、边界值。
- `src/note/main.ts`：`ResizeObserver` 驱动 `computeLayout` → 写 CSS 变量 + 挂/卸 `#assistant-pane` + 通知 Rust placement；移除依赖 `assistant://embedded` 加宽的旧逻辑。
- `src/styles.css`：内容区改为 `[--left-margin][--text-width][--right-margin]` 布局；`#assistant-pane` 改为「嵌在右边距、无左边框、透明背景、与正文同底」。
- `src/assistant/styles.css`：根容器透明化（仅独立窗形态）；气泡/输入/机器人保留底色。
- `src/assistant/main.ts`（独立窗）：加入 `mousemove` 命中检测 → `setIgnoreCursorEvents`。
- `src/note/topbar.ts` + 新标题栏渲染：robot_icon 迁到第一行最右；第二行去掉 robot_icon。

## 11. 错误处理与边界

- 子窗 attach / 透明 / Overlay 任一平台 API 失败：降级到现有事件重定位 + 实底，并打印告警，不影响核心功能。
- `computeLayout` 对极端输入（极小/极大宽度、`open=false`）有确定输出，由单测固定。
- 助手在 embedded↔detached 切换瞬间避免「双份助手」：同一时刻只挂载一处（CSS 决定嵌入栏可见性，命令决定独立窗可见性，互斥）。

## 12. 测试

- 前端 Vitest：`computeLayout` 全分支（重点）；穿透命中检测的纯判定部分若可抽纯函数则一并测。
- Rust `cargo check` + 手动 `npm run tauri dev`：拖动跟随、透明穿透、标题栏两端外观、三区切换与重叠区手动切。
- 跨平台：macOS（Overlay 标题栏、addChildWindow、原生全屏落入宽区）与 Windows（无边框标题栏、owner 窗、最大化）各手验一遍。

## 13. 跨平台注意

- 标题栏、子窗、透明穿透均为平台敏感项，按 AGENTS.md 在两端验证。
- 写实现计划阶段用 Context7 核对：Tauri 2 父子窗口 API、`setIgnoreCursorEvents`、macOS `titleBarStyle/hiddenTitle` 与 Windows 无边框自绘控制的现行用法。
