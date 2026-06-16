# Sprint 6 — 打包 / 跨平台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development / executing-plans。执行前展开为 bite-sized 步骤。依赖前 5 个 sprint。执行前用 Context7 确认 Tauri 2 sidecar（external binary）当前配置方式与 `tauri.conf.json` 字段。

**Goal:** 把 Node agent-sidecar 打成自带运行时的单可执行文件，作为 Tauri sidecar 随应用分发；让 `npm run tauri build` 在 macOS 与 Windows 都能产出可直接运行（无需用户预装 Node）的安装包；把开发期的 `npx tsx` 路径切换为生产期的打包二进制。

**Architecture:** 用 `bun build --compile`（或 Node SEA）把 `sidecar/` 编译为各平台单文件二进制，命名遵循 Tauri sidecar 的 `name-<target-triple>` 约定，放入 `src-tauri/binaries/`。`tauri.conf.json` 的 `bundle.externalBin` 声明它；`capabilities` 放行 `shell:allow-execute`/sidecar 权限。`agent.rs` 改用 `tauri_plugin_shell` 的 sidecar API（或 `app.shell().sidecar(...)`) 启动，dev/prod 用同一路径。

**Tech Stack:** Tauri 2 sidecar / externalBin、`tauri-plugin-shell`、bun 或 Node SEA、CI（可选）。

---

## ⚠️ 执行前置

用 Context7 拉取 Tauri 2 文档，确认：
- `bundle > externalBin` 与 target-triple 命名规则当前写法。
- 通过 `tauri-plugin-shell` 启动 sidecar 的 API（`Command::new_sidecar` / `app.shell().sidecar`）及其 stdin/stdout 流式读写方式（Sprint 3 用的是裸 `std::process`，这里统一到插件以获得打包与权限支持）。
- `capabilities/default.json` 中 sidecar 执行权限项。

结果记到"Tauri 核对"小节。

---

## 文件结构

- Create: `sidecar/build.*` — 编译脚本（bun compile 或 node --experimental-sea-config）
- Create: `src-tauri/binaries/agent-sidecar-<triple>`（构建产物，按平台）
- Modify: `src-tauri/Cargo.toml` — 加 `tauri-plugin-shell`
- Modify: `src-tauri/tauri.conf.json` — `externalBin`、`bundle.resources`（如需）
- Modify: `src-tauri/capabilities/default.json` — sidecar/shell 执行权限
- Modify: `src-tauri/src/lib.rs` — 注册 shell 插件
- Modify: `src-tauri/src/agent.rs` — 改用 sidecar 启动；dev 仍可回退 `tsx`（env 判断）
- Modify: `package.json` — `prebuild`/脚本：tauri build 前先 build sidecar 二进制
- Modify: 根 `.gitignore` — 忽略大体积构建产物（或用 git-lfs / CI 构建，二选一并记录）

---

## Task 1: sidecar 单文件构建

- [ ] 选定方案（推荐 bun：`bun build sidecar/src/main.ts --compile --outfile <out>`；Node SEA 作为备选并在文档说明取舍）。确认产物能独立运行：`echo '{"type":"configure",...}\n{"type":"prompt",...}' | ./agent-sidecar-<triple>`。
- [ ] 处理 Pi 依赖的原生/外部资源（若有 `--ignore-scripts` 安装的二进制依赖，确认随打包可用）。
- [ ] 产物按 `agent-sidecar-<target-triple>` 命名放入 `src-tauri/binaries/`（macOS arm64/x64、Windows x64 各一）。
- [ ] 提交：`build(sidecar): single-file compiled binary`。

## Task 2: Tauri sidecar 接线

- [ ] 加 `tauri-plugin-shell`，`lib.rs` 注册插件。
- [ ] `tauri.conf.json` 声明 `externalBin: ["binaries/agent-sidecar"]`；`capabilities/default.json` 放行 sidecar 执行。
- [ ] `agent.rs`：启动改用 sidecar API；保留 `FLOATNOTE_SIDECAR_DEV=1` 时回退 `npx tsx sidecar/src/main.ts`，方便本地开发。stdin/stdout 流式读写按插件 API 调整（保持 Sprint 3 的协议 handler 不变）。
- [ ] 提交：`feat(packaging): launch sidecar via tauri-plugin-shell`。

## Task 3: 构建流水线

- [ ] `package.json` 加脚本：`"build:sidecar"`（按当前平台 triple 产出二进制）、`"build:app":"npm run build:sidecar && tauri build"`。
- [ ] 文档化多平台构建：本机只产本平台 triple；跨平台二进制由对应平台或 CI 产出。
- [ ] 提交：`build: wire sidecar build into app packaging`。

## Task 4: 跨平台验证

- [ ] macOS：`npm run build:app` → 安装/运行 `.app`，全链路（配置 key → 对话 → AI 改写留版本 → 双窗口模式 → 全屏自动嵌入）跑通，确认未依赖系统 Node。
- [ ] Windows：同上跑通；重点验证 sidecar 进程启动、路径分隔、全屏/最大化行为、窗口吸附。
- [ ] 记录两端结果与差异到本文件。
- [ ] 提交：`test(packaging): verified macOS + Windows packaged builds`。

---

## 验收清单（Sprint 6 Done）

- [ ] 打包产物在干净环境（无 Node）可运行助手功能
- [ ] macOS + Windows 安装包均可用，全链路通过
- [ ] dev 模式（`FLOATNOTE_SIDECAR_DEV=1` + tsx）仍可用
- [ ] sidecar 权限在 capabilities 中最小化放行
- [ ] 构建产物的 git 策略已确定并记录（忽略/LFS/CI）

## Tauri 核对（执行时填写）

- Tauri 版本：`TODO`
- externalBin 命名/配置实测：`TODO`
- sidecar stdin/stdout 流式 API：`TODO`
