# 笔记窗内快捷键设计

日期：2026-07-09
状态：已确认，待编写实现计划

## 目标

为笔记窗增加一套**窗口内**键盘快捷键（笔记窗聚焦时生效，非系统全局），覆盖 AI 助手、行动面板、视图切换、新对话等高频操作；并提供 Esc 作为通用关闭键、设置页自定义录制与冲突检测。所有快捷键跨平台（mac=Cmd，Win=Ctrl），不动 Tauri global-shortcut 与 capabilities。

## 范围

- 新增窗内快捷键分派模块（中央 keydown 监听）。
- 8 个可自定义组合 + Esc 条件触发 + 字号固定项。
- 设置页新增"窗口快捷键"区块，复用 `KeyRecorder`，带冲突警告。
- 共享冲突检测模块，设置页与笔记窗共用。
- 前端 Vitest 单测。

非目标：不改 Rust global-shortcut 体系、不新增系统级快捷键、不引入命令面板、不改 CodeMirror keymap。

## 键位

全部在笔记窗聚焦时生效；`Cmd/Ctrl` 指 mac 上 Cmd、Win 上 Ctrl。匹配键 `preventDefault`。

| 操作 | 默认键 | 可自定义 | 行为 |
|---|---|---|---|
| 切换 AI 助手（整体开/关） | `Cmd+J` | ✅ | 等价标题栏 robot 图标点击：`onAssistantToggle` → `invoke("toggle_assistant")` |
| 切换 AI 对话气泡 | `Cmd+B` | ✅ | 连带：助手未开→先开助手再展开气泡+聚焦输入；已展开→收起（`setInputOpen`） |
| 切换行动面板 | `Cmd+T` | ✅ | `tasksPanel.toggle()` |
| 添加下一项行动 | `Cmd+G` | ✅ | 连带：面板未开→先开面板；展开 `.tasks-add` 表单并聚焦输入（`setAdding(true)`） |
| 新对话 | `Cmd+K` | ✅ | `startNewConversation()`（连带开助手+展开气泡+聚焦输入） |
| 视图·采集 | `Cmd+1` | ✅ | `onSelectView("inbox")` |
| 视图·写作 | `Cmd+2` | ✅ | `onSelectView("piece")` |
| 视图·双栏 | `Cmd+3` | ✅ | `onSelectView("split")`；窄窗 `canSplit=false` 时回落写作 |
| 取消 AI 回复 | `Esc` | ❌ 固定 | **仅当焦点在助手区 且 AI 正在流式** → `agent_cancel` |
| 字号 +/−/复位 | `Cmd+=` / `Cmd+-` / `Cmd+0` | ❌ 固定 | 复用现有字号逻辑；新增 `0` 复位默认 |

> `J`/`G` 无字母助记——`A`(全选)、`N`(系统新窗口)、`Enter`(CM 占用) 均被占，故选空闲且安全的 `J`/`G`。

### 键位冲突依据（实测）

CodeMirror 当前 `defaultKeymap + historyKeymap`（`editor.ts:50`）实际占用的 `Mod+字母/符号`：`A`(全选)、`I`、`U`/`Shift+U`、`Y`/`Z`/`Shift+Z`、`[`/`]`、`/`、`Enter`、`Backspace`、`Delete`、`Home`、`End`、方向键、`Shift+K`。据此 `Mod+K`(单 K) 空闲、`Shift+Mod+K` 被占，故新对话用 `Cmd+K` 而非 `Cmd+Shift+K`。

系统/平台保留（不可用）：`Mod+Q/W/M/H`(退出/关窗/最小化/隐藏)、`Mod+N`(新窗口)、`Mod+R`(刷新)。复制粘贴：`Mod+C/V/X`。

## Esc 优先级链

单一 `document` keydown 监听，自上而下**首个命中即止**：

1. 助手历史浮层开 → 关浮层（迁移现有 `assistant.ts:263` 的 Esc 行为）
2. **焦点在助手区** 且 AI 正在流式 → 取消回复（`agent_cancel`）
3. 行动面板开 → 关行动面板（`tasksPanel.setOpen(false)`）
4. AI 气泡展开 → 收起气泡（`setInputOpen(false)`）
5. 否则无操作

实现"先关行动面板、再收气泡"的分层；取消回复作为焦点相关的覆盖项，仅在"聚焦助手 + 流式"时插队到最前。

- 焦点判定：`isFocusInAssistant()` = `document.activeElement` 属于 `#assistant-region`。
- 流式判定：由 assistant 句柄 `isStreaming()` 提供（基于 `render.ts` 状态机 streaming 标志）。

## 模块结构

### `src/note/shortcuts.ts`（新建，中央分派）

```
export interface ShortcutActions {
  toggleAssistant(): void;
  toggleAssistantBubble(): void;     // 连带开助手
  toggleActionPanel(): void;
  quickAddAction(): void;            // 连带开面板
  selectView(v: "inbox" | "piece" | "split"): void;
  startNewConversation(): void;
  // Esc 链
  isAssistantStreaming(): boolean;
  cancelAssistant(): void;
  isActionPanelOpen(): boolean;
  closeActionPanel(): void;
  isAssistantBubbleOpen(): boolean;
  collapseAssistantBubble(): void;
  isHistoryPopoverOpen(): boolean;
  closeHistoryPopover(): void;
  // 字号
  bumpFont(delta: number): void;     // +1 / -1 / 0 复位
}

export function installShortcuts(
  actions: ShortcutActions,
  bindings: Bindings                  // combo → actionId，来自 config
): () => void;                        // 返回卸载函数
```

- 注册**唯一**一个 `document` keydown 监听。
- 用 `eventToCombo(e)` → `canonicalize` 查 `bindings` 表分派。
- 维护 Esc 优先级链。
- `main.ts` 删除 `main.ts:1335` 的字号监听，字号并入本模块（`bumpFont`）；装配末尾调 `installShortcuts`。
- `assistant` 的 `mountAssistant` 增补返回句柄：`{ setInputOpen, isInputOpen, isStreaming, cancel, startNewConversation, isHistoryPopoverOpen, closeHistoryPopover }`，供 main 注入。
- `tasksPanel` 已有 `toggle/setOpen/isOpen`，复用；`setAdding` 已有。
- 本模块不反向 import `main.ts`。

### `src/shared/shortcuts.ts`（新建，设置页 + 笔记窗共用）

- `WINDOW_SHORTCUT_DEFAULTS: Record<id, string>` —— 8 项默认（上表）。
- `eventToCombo(e: KeyboardEvent): string` —— 从 `KeyRecorder` 抽出的复用逻辑，产出 `"Cmd+J"` 格式。
- `canonicalize(combo: string): string` —— `"Cmd+J"` → `"Mod+J"`（Cmd/Win/Ctrl/Meta 归一为 `Mod`，字母大写，保留 Shift/Alt）。
- `RESERVED: { combo: string; reason: string }[]` —— 三类保留键（见下）。
- `checkConflict(combo, { id, all, globals }): { kind, message } | null`。

### 冲突检测

`RESERVED` 不可分配组合 + 原因：

1. **CodeMirror 占用**：`Mod+A`、`Mod+I`、`Mod+U`/`Mod+Shift+U`、`Mod+Y`/`Mod+Z`/`Mod+Shift+Z`、`Mod+[`/`Mod+]`、`Mod+/`、`Mod+Enter`、`Shift+Mod+K` 等。
2. **系统/平台保留**：`Mod+Q/W/M/H`、`Mod+N`、`Mod+R`。
3. **复制粘贴**：`Mod+C/V/X`。
4. **应用固定项**：`Mod+=`/`Mod+-`/`Mod+0`、`Esc`。

`checkConflict` 返回三类冲突（均硬错误）：

- 保留键：`"与「全选」等编辑器快捷键冲突"` / `"与系统快捷键冲突（关窗/最小化…）"` / `"与字号快捷键冲突"`。
- 窗内重复：`"与「切换行动面板」重复"`。
- 撞全局快捷键：`"与全局快捷键「划线引用」重复（窗口聚焦时会双重触发）"`。

## 设置页

`src/settings/main.ts` 新增"窗口快捷键"区块：

- 6 项分组（视图项下含采集/写作/双栏 3 个录制器），共 8 个 `KeyRecorder`。
- 复用现有 `KeyRecorder`（要求至少一个修饰键，避免与打字冲突；默认值均有 Cmd）。
- 任一录制器值变化 → 对全部 8 项 + 3 个全局快捷键跑 `checkConflict`：
  - 命中 → 该录制器下方红字提示，Save 禁用。
  - 清除 → 移除提示，Save 恢复。
- 区块底部"恢复默认"按钮。

## 持久化与热重载

- `config.rs` 增子结构（`#[serde(default)]`）：
  ```rust
  pub struct WindowShortcuts {
      assistant: String,         // "Cmd+J"
      assistant_bubble: String,  // "Cmd+B"
      action_panel: String,      // "Cmd+T"
      add_action: String,        // "Cmd+G"
      new_conversation: String,  // "Cmd+K"
      view_inbox: String,        // "Cmd+1"
      view_piece: String,        // "Cmd+2"
      view_split: String,        // "Cmd+3"
  }
  pub window_shortcuts: WindowShortcuts,
  ```
- `apply_shortcuts` 命令扩展入参收这 8 项、落盘 config、emit Tauri 事件 `window-shortcuts-changed`。
- 新增 `get_window_shortcuts` 命令：返回 8 项（缺字段走 `serde(default)`）。
- 笔记窗 init：读 `get_window_shortcuts` → 构 `bindings` → `installShortcuts`。
- 笔记窗监听 `window-shortcuts-changed` → 重读 → 重建 `installShortcuts`（先卸载旧监听）。

## 测试

`src/note/shortcuts.test.ts`（构造伪造 keydown、mock actions）：

- 各组合键调用对应 action；未绑定组合不触发。
- Esc 链 5 档优先级：每档命中且只命中一条（含"聚焦助手+流式→取消"覆盖行动面板的场景）。
- `canSplit=false` 时 `Cmd+3` 落到写作。

`src/shared/shortcuts.test.ts`：

- `canonicalize`：Cmd/Win/Ctrl 归一、Shift/Alt 保留、字母大写。
- `checkConflict`：保留键（CM/系统/复制粘贴/固定）三类、窗内重复、撞全局，均命中；合法组合返回 null。

`npm test` 跑前端；`npm run tauri dev` 手动验：mac 各键 + Esc 链 + 设置页录制/冲突/保存/热重载，Win 上 Ctrl 等价键。`cargo check`（src-tauri/）验 Rust 改动。

## 跨平台与边界

- 修饰键统一 `e.metaKey || e.ctrlKey`（与现有字号逻辑一致）。
- 双栏窄窗不可用：`Cmd+3` 回落写作。
- 覆盖层（重命名/新建输入、项目切换子菜单、版本面板）打开时：这些键不与覆盖层 Esc/Enter 冲突，第一版不加专门抑制；如误触再补"覆盖层打开抑制 toggle"开关。
- 不动 `capabilities/default.json`、不动 `shortcuts.rs` 全局注册。
