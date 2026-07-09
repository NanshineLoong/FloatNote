# 项目切换三点菜单 + 打开现有项目 设计

日期：2026-07-09
状态：已确认，待写实现计划

## 背景

FloatNote 顶栏左上角的项目名按钮点击后弹出切换菜单，列出"最近项目"（`recent_projects`，文件夹 MRU）和"文档"（`recent_documents`，散件 `.md` MRU）。现状每行悬停露出"重命名（铅笔）"和"删除（垃圾桶）"两个按钮，删除 = `trash::delete` 进系统回收站。`+` 二级菜单提供"在当前目录新建 / 选择位置新建…"；NO_PROJECT 空态提供"新建项目"主按钮。

本设计在不动"项目/文档两条线"的前提下，做三件事：

1. 把行内"铅笔+垃圾桶"换成单个 `⋯`（kebab）按钮，点击展开二级菜单，承载更多操作。
2. 新增"从最近列表移除"操作——仅从 MRU 摘除路径，不碰磁盘文件（区别于"删除"丢回收站）。
3. 新增"打开现有项目"入口——选一个已有文件夹，无 `_inbox.md` 则自动建空 `_inbox.md`，目录内其他 `.md` 作为 piece 显示。

## 决策汇总

- "打开现有项目"在原生对话框里**选文件夹**（不选单个文件）。项目线（文件夹）与文档线（散件 `.md`）不合并。
- 项目行与文档行**都**改用 kebab 三点菜单，菜单项均为：重命名 / 从最近列表移除 / 删除(废纸篓)。
- kebab 入口放两处：`+` 二级菜单加第三项「打开现有项目…」；NO_PROJECT 空态加一个次按钮。
- "移除"不弹确认（可重新"打开现有项目"找回）；"删除"保留现有确认弹窗。
- 实现路线 B：`makeSwitcherRow` 接收 `actions: RowAction[]`，菜单构造抽到单一 `openRowKebab` helper，项目/文档两行复用。

## 架构与组件

### 前端（src/note/）

- `main.ts` — `makeSwitcherRow` 重构：签名从 `{ label, active, onOpen, onRename, onDelete }` 改为 `{ label, active, onOpen, actions: RowAction[] }`。
  - `RowAction = { label: string; icon: string; danger?: boolean; onClick: () => void }`。
  - 行内只渲染一个 `⋯` 按钮（`ph-dots-three`，`title="更多"`）。悬停露出规则不变，复用 `.switch-row-actions` 的 hover/focus-within CSS。
- 新增 `openRowKebab(trigger: HTMLElement, items: RowAction[])`：构造 `.switch-submenu` 浮层锚定到 trigger 下方，逐项渲染按钮（`danger` 项给红色类），点击任一项 → 执行 `onClick` + 关闭浮层；外部点击 / Esc 关闭。定位与关闭逻辑直接复用 `openProjectAddSubmenu` 现有实现（抽公共的 anchor 定位 + 全局 click-away 监听）。同一 switch 菜单内同时只允许一个 kebab 浮层：新开前先关闭已有的。
- `showProjectSwitcher` 调用处：
  - 项目行 `actions = [重命名, 移除, 删除]`，`onClick` 分别接 inline 改名、`removeProjectFromRecent`、`deleteProjectFlow`。
  - 文档行 `actions = [重命名, 移除, 删除]`，`onClick` 分别接 inline 改名、`removeDocumentFromRecent`、`deleteDocumentFlow`。
- 新增 `removeProjectFromRecent(project)` / `removeDocumentFromRecent(doc)`：纯前端，过滤 `recent` / `recentDocs` → `setRecentProjects` / `setRecentDocuments`。若移除的是当前打开项，则清当前状态 + `bootstrapProjects` 重定位（与 `deleteProjectFlow` 的"当前项被移除"分支同构，但不删磁盘文件、不弹确认）。抽出纯函数 `removeFromRecent(list, path)` 便于单测。
- 新增 `openExistingProject()`：`open({ directory: true })` → 拿到 dir → `invoke("open_existing_project", { dir })` → 返回 `ProjectEntry` → `rememberProject` + `openProject`。入口接线两处：`openProjectAddSubmenu` 加第三项「打开现有项目…」；NO_PROJECT 空态 `primary` 旁加次按钮「打开现有项目」。
- `deleteProjectFlow` / `deleteDocumentFlow` 保留（kebab 的"删除"项调它们，含确认弹窗 + `trash::delete`）。

### 后端（src-tauri/src/）

- `project.rs` 新增 `open_existing_project(dir: &Path) -> Result<ProjectEntry, OpenProjectError>`：
  1. `dir` 不存在或不是目录 → `Err(NotADirectory)`。
  2. 无 `_inbox.md` → 用 `write_atomic` 写空 `_inbox.md`（避免半写）。
  3. 已有 `_inbox.md` → 原样返回。
  4. 返回 `ProjectEntry { name: dir.file_name(), path: dir }`。
  - 不预建 `_tasks.md` / piece，与 `create_project` 的惰性策略一致。
- `commands.rs` 新增 `open_existing_project(state, dir) -> Result<ProjectEntry, String>`：调 `project::open_existing_project`，**并把 `working_dir` 设为 `parent(dir)` 落盘**（镜像 `create_project` 的隐式行为，保证"在当前目录新建"与 `list_projects` 扫描语义一致）。错误序列化成中文友好字符串。
- `lib.rs` 注册新 command。
- 不新增 fs 权限：dialog `allow-open` 已覆盖目录选择，文件操作仍走自定义 command。

## 数据流

### 打开现有项目（文件夹）

```
openExistingProject()
  → dialog open({ directory: true })        // 用户选文件夹
  → invoke("open_existing_project", { dir })
       Rust: 校验是目录 → 无 _inbox.md 则 write_atomic 写空 → 设 working_dir=parent(dir) 落盘 → 返回 ProjectEntry
  → rememberProject(path)                   // pushRecent + setRecentProjects（MRU 置顶、去重、封顶8）
  → openProject(entry)                      // 切换编辑器到该项目的 _inbox
       → watch_dir 切到该目录；list_pieces 拉取目录内 .md（排除 _ 前缀）作为 piece
```

目录里已有的 `.md` 自动进 piece 列表，无需额外处理——`list_pieces` 本就排除 `_` 前缀并按 mtime 倒序。

### 移除（从最近列表）—— 纯前端，零磁盘副作用

```
kebab「移除」→ removeProjectFromRecent(project)
  → recent = removeFromRecent(recent, project.path)
  → setRecentProjects(recent)              // set_config 写回 config.json
  → 若 project.path === currentProject.path：清当前状态 + bootstrapProjects 重定位
  → 关闭 kebab 浮层 + 关闭外层 switch 菜单
```

文档行同理，操作 `recentDocs` / `setRecentDocuments`。移除不弹确认，与"删除"形成明确区分。

### kebab 菜单交互流

```
hover 行 → ⋯ 按钮露出
click ⋯  → openRowKebab(trigger, actions) → 浮层锚定 trigger 下方
click 任一项 → onClick() + 关闭浮层
外部 click / Esc → 关闭浮层
```

浮层关闭不连带关闭外层 switch 菜单（除非该操作本身要刷新列表，如移除/删除后重渲染）。

### MRU 一致性

`resolveProjects` 在每次打开 switch 菜单时静默丢弃磁盘上已不存在的路径，所以"移除"只是把路径从 MRU 摘掉，文件仍在原地——用户下次"打开现有项目"选同一文件夹即可找回，且回写后的 config 不含冗余路径。

## 错误处理

### 打开现有项目

| 失败情形 | 处理 |
|---|---|
| 用户在 dialog 取消 | `open()` 返回 null，`openExistingProject` 直接 return，无副作用 |
| 所选路径不存在 / 不是目录 | Rust `OpenProjectError::NotADirectory` → 前端提示"所选路径不是文件夹" |
| `_inbox.md` 写入失败（只读/权限） | `write_atomic` 失败 → 返回 Err，前端提示"无法在该文件夹创建 Inbox，请检查权限"；**不**把路径加入 recent，**不**切当前项目（事务性：要么全成功，要么不留下半成品状态） |
| 所选目录已在 recent 中 | `pushRecent` 天然去重，置顶即可，不报错 |

原则：`open_existing_project` 是原子的——要么 Inbox 建好 + working_dir 落盘 + 返回 entry，要么什么都不改。`write_atomic` 的临时文件 + rename 保证 Inbox 不半写；working_dir 的 `set_config` 在 Inbox 成功之后才执行。working_dir 落盘失败时仍返回 entry 但记 warn（Inbox 已建好、项目可用，working_dir 只是扫描根辅助项，不该因此阻塞打开）。

### 移除

纯前端，几乎不会失败。唯一边界：`set_config` 写盘失败 → 沿用现有 `setRecentProjects` 的错误传播，前端提示"无法保存最近项目列表"。内存 `recent` 已更新，本次会话内表现正常，下次启动回退到旧列表——可接受，与现有 delete/rename 写 config 失败的处理一致。

### kebab 菜单

- 浮层已打开时再点同一 `⋯` → 切换关闭（避免叠层）。
- 浮层打开期间行被重渲染（极端情况）→ click-away 监听绑在 document，目标按钮脱离 DOM 时点击无 effect，自然关闭，不抛错。
- 同一 switch 菜单内同时只允许一个 kebab 浮层：新开 kebab 前先关闭已有的。

### 删除（废纸篓）

保留现有 `deleteProjectFlow` / `deleteDocumentFlow` 的确认 + `trash::delete` 错误传播，不动。

## 测试

### 前端单元测试（Vitest）

- `recent-projects.test.ts`（已存在，扩展）：新增对 `removeFromRecent(list, path)` 纯函数的测试——移除存在项、移除不存在项（no-op）、移除后顺序不变、空列表 no-op。
- kebab 菜单：若项目有 jsdom 习惯，测 `openRowKebab` 的 items 渲染（按钮数、danger 类、点击触发 onClick 并关闭）；否则降级为对 `buildKebabItems`（纯函数返回 items 数组）的测试，DOM 行为靠手测。
- `makeSwitcherRow` 新签名：断言传入 `actions` 数组后渲染出单个 `⋯` 按钮（而非多个操作按钮）。

### 后端（无 Rust 测试套件，按 CLAUDE.md 约定）

- `cargo check` 通过。
- `open_existing_project` 的核心逻辑（`is_project_dir` 判断 + 无 Inbox 时建空文件 + 已有 Inbox 时 no-op）尽量写成不依赖 Tauri AppState 的纯函数，便于未来加 `#[test]`；本次至少手测：
  1. 选已有 `_inbox.md` 的文件夹 → 直接打开，不改动文件。
  2. 选含若干 `.md` 但无 `_inbox.md` 的文件夹 → 建空 `_inbox.md`，piece 列表显示那些 `.md`。
  3. 选空文件夹 → 建空 `_inbox.md`，piece 列表为空。

### 手测脚本（`npm run tauri dev`）

1. kebab 三项在项目行/文档行都出现，悬停露出、点击展开、外部点击/Esc 关闭。
2. "移除"：路径从列表消失、不进废纸篓、磁盘文件原样在；移除当前项后正确重定位。
3. "删除"：仍弹确认、文件夹进废纸篓。
4. "打开现有项目"：`+` 菜单与空态两入口都可达；无 Inbox 自动建；已有 `.md` 显示为 piece；working_dir 更新后"在当前目录新建"指向新父目录。
5. 跨平台：macOS 与 Windows 各跑一遍 kebab 浮层定位与 dialog 目录选择（路径分隔符自适应已在 `notes-state.ts` 处理，重点验 Windows）。

## 涉及文件

- 前端：`src/note/main.ts`（`makeSwitcherRow` `:1031`、`showProjectSwitcher` `:884`、`deleteProjectFlow` `:1115`、`openProjectAddSubmenu` `:1185`、`createDefaultProject` 空态 `:839`、`openProject` `:753`、`bootstrapProjects` `:802`）、`src/note/recent-projects.ts`（新增 `removeFromRecent`）、`src/note/notes-state.ts`（`setRecentProjects`/`setRecentDocuments` 复用）、`src/note/recent-projects.test.ts`、`src/styles.css`（`.switch-submenu` / kebab 按钮样式，`:642-671` 附近）。
- 后端：`src-tauri/src/project.rs`（新增 `open_existing_project`）、`src-tauri/src/commands.rs`（新增同名 command + working_dir 落盘）、`src-tauri/src/lib.rs`（注册 command）。
- 权限：`src-tauri/capabilities/default.json` 无需改动。
