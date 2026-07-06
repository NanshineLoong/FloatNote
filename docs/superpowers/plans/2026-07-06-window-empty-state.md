# 窗口空态设计实现计划

> 设计已在 brainstorming 阶段获批。本文件为执行计划，按 task 顺序实现。
> Worktree: `worktree-empty-state`

## 背景
当前代码用 `?? createProject(...)` / `?? createNote(dir)` 两个兜底把所有"列表为空"强制填上文件，导致几乎不存在真正空态。改为显式 4 态状态机驱动渲染，只在用户显式"新建"时才建文件。

## Task 1: 后端 — 扩展 `create_note` 接受可选 title
- 文件: `src-tauri/src/commands.rs` (`create_note` 66-80)、`src-tauri/src/notes.rs`
- 改 `create_note` 签名为接受可选 `title: Option<String>`。
- 传入 title 时：`sanitize_folder_name(title)` + `unique_filename(dir, &stem)` 落盘为 `<title>.md`。
- 不传时维持当前时间戳行为（向后兼容）。
- 前端 wrapper `createNote` (`src/note/notes-state.ts:150-152`) 增加可选 title 参数透传。
- 验证: `cargo check`（在 `src-tauri/`）。

## Task 2: 后端 — `create_project` 只 scaffold `_inbox.md`
- 文件: `src-tauri/src/project.rs:129-140` (`create_project`)
- 移除 `std::fs::write(dir.join(TASKS_FILE), "")` 与 `std::fs::write(dir.join(DEFAULT_PIECE), "")`。
- 仅保留 `create_dir_all` + 写 `_inbox.md`。
- 注意: `DEFAULT_PIECE` 常量若仅此处使用可保留不动（避免扩散改动）。
- 验证: `cargo check`。

## Task 3: 前端 — 窗口状态机
- 新建 `src/note/window-state.ts`：
  - `type WindowState = NO_PROJECT | PATH_ERROR | NO_PIECE | LOADED`（定义见设计 §1）
  - 纯函数 `resolveBootstrap({ recent, projects, error })` 与 `resolveOpenProject({ pieces, error })`，返回正确态。
- 新建 `src/note/window-state.test.ts`：覆盖各分支（MRU 命中 / MRU 全失效 / listProjects 空 / listProjects 报错 / pieces 空 / pieces 报错）。
- 验证: `npm test`（window-state.test.ts 通过）。

## Task 4: 前端 — 共享 EmptyState 组件
- 新建 `src/note/empty-state.ts`：`renderEmptyState(target, props)`，props = `{ icon, title, hint?, primary?, secondary? }`。
- 样式: 在 `src/styles.css` 加 `.empty-state` 系列类（居中、淡色）。
- 新建 `src/note/empty-state.test.ts`：数据驱动覆盖 6 套 props，断言文案与按钮 click 触发 action。
- 验证: `npm test`。

## Task 5: 前端 — bootstrap 改造（移除兜底）
- 文件: `src/note/main.ts` (`bootstrapProjects` 464-477, `openProject` 444-460, `loadFirstPiece` 297-302, `init` 882-897)
- `bootstrapProjects` 用 try/catch 包裹 `resolveProjects` / `listProjects`，错误进 `PATH_ERROR`；空列表进 `NO_PROJECT`；不再 `?? createProject`。
- `openProject` → `loadFirstPiece` 不再 `?? createNote`，pieces 空 → 返回 `NO_PIECE`。
- `init` 根据 `WindowState` 分发渲染：NO_PROJECT/PATH_ERROR → EmptyState 到 `#note-body`/`#editor-root`；NO_PIECE → EmptyState 到写作面区域；LOADED → 原流程。
- 验证: `npm run build`（tsc 通过）+ 手测矩阵 1/2/4/5。

## Task 6: 前端 — 6 个空态文案与按钮接入
- 在 §5 渲染分发处接入 EmptyState props：
  - NO_PROJECT: title "欢迎来到 FloatNote", hint "还没有项目空间。新建一个项目开始写作，或直接新建一篇独立文档。", primary 新建项目, secondary 新建文档。
  - NO_PIECE: title "这里还没有作品", hint "在「{项目名}」里新建一篇开始写作。", primary 新建作品。
  - PATH_ERROR: title "无法读取工作目录", hint "{error}。可在设置里重新选择目录。", primary 打开设置, secondary 重试。
- 切换菜单两区空态: `main.ts:501-573` (`showProjectSwitcher`)，`length === 0` 的 section 改挂"暂无项目/暂无文档"提示行 + 新建按钮。
- piece 内容空提示: `main.ts:160-169` pieceEditor 加 `placeholder("开始写……")` 扩展（复用 inbox 的 placeholder 机制）。
- 验证: 手测矩阵 1-5。

## Task 7: 前端 — 新建流程（默认名 + 标题栏聚焦全选）
- 新建项目: NO_PROJECT 点 primary → `createProject(startDir, "未命名项目")` → `openProject` → 落 NO_PIECE（因 Task 2 不再 scaffold piece）。不自动聚焦。
- 新建作品: NO_PIECE 点 primary → `createNote(dir, "未命名作品")` → 载入 LOADED → 聚焦标题栏并全选。
- 新建文档: NO_PROJECT 点 secondary → 建默认名独立文档 → 载入 → 聚焦标题栏并全选。
- 改名提交: 标题栏 Enter/blur → `rename_note` 用输入标题；空输入保留默认名。
- 实现期定位: pieces / 独立文档的"标题栏原地改名"UI 元素（piece-switcher / topbar），确认能否程序化 focus+select。
- 验证: 手测矩阵 3（新建作品→改名→文件名正确）。

## Task 8: 前端 — 运行期外部删除兜底
- watcher 回调: 当前 piece 被外部删除 → 列剩余 pieces，空则切 NO_PIECE，非空切 `pieces[0]`，不再建时间戳。
- 当前项目目录被外部删除 → 切 NO_PROJECT（或 PATH_ERROR 若 startDir 也失效）。
- `_tasks.md` 缺失懒创建: `tasks-panel.ts` 读取时当作空任务列表，不报错；首次添加任务时落盘。
- `_inbox.md` 缺失 → 该目录不再是项目，从列表消失。
- `listPieces` 中途报错 → PATH_ERROR。
- 验证: 手测矩阵 6 + `npm test`。

## Task 9: 收尾
- `npm test` 全绿；`npm run build` tsc 通过；`cargo check` 通过。
- 双平台手测矩阵全过（mac 本机；Windows 记录待测）。
- 调用 `superpowers:finishing-a-development-branch` 收尾。

## 手测矩阵
1. 清空工作目录 → 首次打开见 NO_PROJECT 欢迎空态，无任何文件被建。
2. 点"新建项目" → 仅出现 `未命名项目/_inbox.md`，无 `piece.md`/`_tasks.md`，落 NO_PIECE。
3. 点"新建作品" → 建 `未命名作品.md`，标题栏聚焦全选，键入改名后文件随之改名。
4. 删光所有 piece → 回到 NO_PIECE，无时间戳文件生成。
5. 设置里把 `working_dir` 改成不存在路径 → PATH_ERROR 空态 + 重试可用。
6. 运行期在 Finder 删当前 piece → 切下一片或 NO_PIECE，不建时间戳。

## 风险与注意
- 标题栏原地改名 UI 元素未前置确认（Task 7 实现期定位）。若不存在或不可程序化聚焦，需回退到"弹标题输入框"方案——届时停下与用户确认。
- `create_note` 改签名需保证所有调用点向后兼容（title 为 Option）。
- 懒创建 `_tasks.md` 要兜住 tasks-panel 读取不存在文件的报错路径。
