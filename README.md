# FloatNote

FloatNote 是一个基于 Tauri 2 的本地优先 Markdown 笔记桌面应用。前端负责多窗口编辑体验，Rust 主进程是本地文件与窗口状态的唯一可信边界，AI 助手在受控的 Node sidecar 中运行。

## 开发

要求：Node.js 22.19 或更高、Rust stable，以及 macOS 或 Windows 的 Tauri 开发环境。

```bash
npm install
npm run tauri dev
```

常用质量门禁：

```bash
npm run test
npm run build
npm run smoke:sidecar
npm run check
(cd src-tauri && cargo test --lib)
(cd src-tauri && cargo check --release)
```

`npm run tauri build` 会先构建 sidecar bundle、把 bundle 放入 Tauri resources，并把构建机提供的 Node runtime 作为 Tauri external binary 一同打包。最终用户不需要预先安装 Node.js。

## 架构

```text
WebView entries ──► feature modules / src/platform ──► Tauri commands ──► Rust domains
                                      │                                  │
                                      └── shared DTO/events              └──► Node AI sidecar (JSONL)
```

- `src/`：Vite 多页面前端；入口 HTML 留在根目录是 Vite 的标准 MPA 约定。
- `src/platform/`：共享的 agent/chat gateway 与跨 feature DTO。
- `src/note/`、`src/assistant/`、`src/history/`、`src/settings/`、`src/popup/`：各窗口/feature 的 UI 与控制逻辑。
- `shared/note-logic/`：前端与 sidecar 共用、无 DOM 与 I/O 的 Markdown/标签领域逻辑。
- `sidecar/`：AI agent；开发时以 `tsx` 启动，发布时运行 Tauri 打包的 Node runtime 与 ESM bundle。
- `src-tauri/`：Rust 主进程；唯一执行本地文件写入、版本快照、窗口/系统能力和 sidecar 权限闸。

详细说明见：

- [架构总览](docs/architecture/overview.md)
- [运行时边界](docs/architecture/runtime-boundaries.md) 与 [数据流](docs/architecture/data-flow.md)
- [前端](docs/architecture/frontend.md)、[Rust 后端](docs/architecture/backend.md)、[sidecar](docs/architecture/sidecar.md)、[打包](docs/architecture/packaging.md) 与 [安全边界](docs/architecture/security.md)
- [开发环境](docs/development/setup.md) 与 [跨平台注意事项](docs/development/cross-platform.md)
- [测试与质量门禁](docs/development/testing.md)
- [发布流程](docs/development/release.md)
- [架构决策记录](docs/adr/README.md)
