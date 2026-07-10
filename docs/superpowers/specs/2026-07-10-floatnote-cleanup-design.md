# FloatNote 深度冗余清理与结构简化 — 设计

日期：2026-07-10
状态：待实现
执行模型：Subagent-Driven Development（SDD）

## 1. 目标与约束

对 FloatNote 全部四个组件（前端 `src/`、Rust `src-tauri/`、`shared/note-logic`、`sidecar/`）
做行为保持型重构：去重、删死代码、抽取共享模式、拆分超大文件，在功能完全不变
的前提下提升可维护性、可扩展性与可测试性，降低模块耦合，巩固架构分层与模块边界。

### 不变量
- **行为保持**：所有改动不得改变任何可观察行为。重构 = 仅移动/合并/抽取/删除，
  不改语义、不改公开接口（除非是纯内部实现细节）。
- **风格遵循**：TS 用 2 空格 / 双引号 / 分号 / camelCase / ES modules 显式导入；
  Rust 用 `rustfmt` / snake_case / `serde` 可序列化的命令载荷；项目空间文件操作
  落 `notes.rs`/`project.rs`，不进 `commands.rs`。各模块遵循自身 `AGENTS.md`。
- **跨平台**：触及 tray / 全局快捷键 / accessibility / 窗口装饰等平台敏感处时，
  须加 capability/平台判断，并在任务报告里标注平台影响。

## 2. 任务分解

每任务 = 一个 SDD 任务（implementer 子智能体 → reviewer 子智能体 → fix-loop）。

### T0 — 基线
在当前 main 上跑 `npm test` / `npm run build`(tsc) / `cargo check`(from `src-tauri/`)，
记录通过状态作为回归基准。新建分支 `refactor/cleanup`（普通分支，非 worktree）。

### A. 结构拆分（AGENTS.md 已标注候选）
- **T1** 拆 `src/note/main.ts`(1658)：初始化/引导 与 事件接线 与 其余职责分离。
- **T2** 拆 `src-tauri/src/agent.rs`(1167)：协议类型 + spawn/read-loop +
  `handle_apply_edit*` 处理器分离。
- **T3** 拆 `src/note/preview.ts`(1052)：decoration builder / widget 类 /
  app-icon cache 分离。
- **T4** 拆 `src/assistant/render.ts`(544)：状态机(`reduceEvents`/`ChatState`) 与
  DOM 渲染(`renderMessage`/`renderBlock`) 分离。
- **T5** 从 `src/assistant/mention-picker.ts` + `skill-picker.ts` 抽取共享
  dock-dropdown 模式。
- **T6** 拆 `sidecar/agent.ts`(415)：model builder / event-translate / runner 分离。

### B. 去重 + 死代码清扫（在拆分后状态上做，按组件分任务以免文件重叠）
- **T7** 前端去重/死代码（src/note + assistant + shared + history/popup/settings）。
- **T8** Rust 后端去重/死代码（notes/project/versions/commands 等）。
- **T9** shared/note-logic + sidecar 去重/死代码。

### T-final — 终审
整支分支终审：用字面 `/code-review`（正确性）与 `/simplify`（去重/简化/效率/altitude）
审全分支 diff；跑全量 `npm test` / `npm run build` / `cargo check`；随后
`superpowers:finishing-a-development-branch`。

## 3. 执行模型（SDD + 两个 skill 的落位）

- **implementer 子智能体**：每任务一个全新子智能体，拿到任务 brief（含该任务
  可改文件清单、相关接口、不变量、验证命令）→ 实现 + 跑测试 + 自审 + 提交。
- **reviewer 子智能体**：每任务一个，prompt 内嵌 `/code-review` 与 `/simplify`
  的质量透镜（正确性 + 去重/简化/效率/altitude），对 `review-package BASE HEAD`
  生成的 diff 文件做 spec 合规 + 质量双判定，返回 Critical/Important/Minor。
  Critical/Important 进 fix 子智能体 → 复审，直到干净。
- **终审**：主会话对全分支真实 diff 调用字面 `/code-review` 与 `/simplify`，
  兑现“两个 diff-based skill 真实作用于 diff”。
- **进度账本**：`.superpowers/sdd/progress.md` 记录每任务 base..head 与复审结果，
  防上下文压缩后丢进度。
- **模型分级**：机械任务（单文件、明确 spec）用便宜/快模型；多文件集成判断用
  标准模型；结构拆分与终审用最强可用模型。每个派发显式指定模型。

### 并行策略（普通分支 + 任务级并行）
- 不用 worktree，因此并行 implementer 必须保证**拥有文件集严格不重叠**。
- 每任务 brief 显式列出它“可改的文件集”（含被拆文件、新建文件、需改导入的调用方）。
  并行批次仅由拥有集两两不相交的任务组成。
- 跨组件天然不重叠（前端 vs Rust vs sidecar vs shared）可并行；
  同一组件内的结构拆分因可能共享调用方导入点，默认顺序执行，除非 brief 证明
  拥有集不相交。
- 拆分任务先于同组件的去重清扫（T7/T8/T9 在 A 组之后），清扫阶段按组件并行。

## 4. 测试与回归策略

- 前端 Vitest：每任务须相关测试绿；结构拆分若迁移纯逻辑，同步迁移/补充聚焦测试
  （`*.test.ts` 置于被测模块旁）。
- Rust 无测试套件：每任务至少 `cargo check`；关键文件操作任务在 `npm run tauri dev`
  下手测受影响流程。
- 全量门：T0 基线 + 每任务局部门 + T-final 全量 `npm test`/`npm run build`/`cargo check`。

## 5. 风险与缓解

- **结构拆分引入行为差异**：implementer 仅迁移不改语义；reviewer 用 diff 验证
  “仅移动/抽取，未改写逻辑”。
- **并行 implementer 冲突**：靠拥有集不重叠约束；重叠则降级顺序。
- **拆分后导入路径变化**：implementer 同步更新所有引用点，`tsc`/`cargo check` 兜底。
- **超拆风险（YAGNI）**：只拆 AGENTS.md 已标注或确有维护痛点的文件，不为拆而拆。

## 6. 范围外（YAGNI）

- 不重新划定跨组件模块边界（如不把 note 逻辑大规模搬入 shared/sidecar）。
- 不新增功能、不改对外行为。
- 不重写已清晰的小模块。
