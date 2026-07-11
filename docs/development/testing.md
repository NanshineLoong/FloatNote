# 测试与质量门禁

| 命令 | 覆盖范围 |
| --- | --- |
| `npm run test:frontend` | 前端与 shared 纯逻辑 Vitest 测试 |
| `npm run test:sidecar` | sidecar protocol、工具和发布路径测试 |
| `npm run build:frontend` | TypeScript 类型检查与 Vite MPA 构建 |
| `npm run build:sidecar` | sidecar TypeScript 编译 |
| `npm run smoke:sidecar` | ESM bundle 的 JSONL ready 握手 |
| `npm run check` | 全部 JS/TS 测试、构建与 sidecar smoke |
| `cargo test --lib` | Rust 领域、协议和 adapter 单测 |
| `cargo check --release` | 发布分支（包括 external sidecar 启动路径）编译 |
| `npm run review:build` | 产出 debug 构建 `src-tauri/target/debug/floatnote`（注册 `tauri-plugin-wdio` / `-webdriver`，供审查驱动） |
| `npm run review:app` | WebdriverIO 通过 `@wdio/tauri-service` 驱动真实 debug 构建，以用户视角操作 webview |

文件系统删除测试在无 Finder/桌面会话的 CI 或沙箱中应使用可替换的 trash adapter；不要把 OS 自动化失败误判为领域逻辑回归。

## WebdriverIO 桌面审查

`npm run review:app` 用 `@wdio/tauri-service` 驱动真实 debug 构建，目标是让 Claude 从用户视角点击/输入/截图，并把 Rust stdout 与 webview console 转发进 reporter（分别带 `[Tauri:Backend]` / `[Tauri:Frontend]` 标记）。

- 配置见 `wdio.conf.ts`，spec 在 `tests/review/`，截图落在 `artifacts/`（已 gitignore）。
- `tauri-plugin-wdio` / `tauri-plugin-wdio-webdriver` 仅在 `#[cfg(debug_assertions)]` 注册，不进 release 产物；`capabilities/default.json` 加了 `wdio:default` 权限。
- review 构建用 `src-tauri/tauri.review.conf.json` patch 合并出 `withGlobalTauri: true`（`@wdio/tauri-plugin` 前端桥需要 `window.__TAURI__`）；release 仍保持 `withGlobalTauri: false`。
- `src/note/main.ts` 在 `import.meta.env.VITE_WDIO === '1'` 时才动态 `import('@wdio/tauri-plugin')`，普通构建被 tree-shake，不进产物。
- 版本钉子：`package.json` 的 `overrides` 把 `@wdio/native-utils` 固到 `2.5.0`，规避 `@wdio/tauri-service@1.2.0` 导入 `installMockSyncOverride` 在 2.4.0 缺失的打包偏差；升级 tauri-service 时需重评此 override。
- 限制：`selection-popup` 窗口由 macOS 辅助功能选区触发，WebDriver 无法驱动，仍靠 `src/popup/*.test.ts` 单测与人工覆盖。

### 当前状态（截至脚手架落地）

已验证可用：
- `npm run review:build` 产出 debug 二进制，插件在 debug 构建注册、release 剥离，两端 `cargo check` 通过。
- `npm run review:app` 能加载配置、启动 `@wdio/tauri-service`、拉起应用进程与 embedded webkit 会话。
- **前后端日志捕获已工作**：`logs/wdio-*.log` 里能看到 `[Tauri:Frontend]`（含 `@wdio/tauri-plugin` 自启与 console 转发）与 `[Tauri:Backend]` 行 —— 这条路已满足"从外部读取 webview console"的目标。

尚未打通：
- `driverProvider: 'embedded'`（v1.2.0，2026-06 发布）的 WebDriver 会话不附着到 app 的 main 窗口 webview，而指向一个空白 webview，导致 `findElement` 找不到 `#note-body`、`browser.tauri.execute` 的 eval wrapper 在 `__wdio_original_core__` 上 5s 超时。已排除 visible/withGlobalTauri/前端插件未加载等成因（日志证明插件已在 main 窗口初始化）。
- 下一步可选：(a) 改 `driverProvider: 'official'` + `cargo install tauri-driver` + 开启 Safari "Allow Remote Automation"，走 safaridriver 经典路径驱动真实窗口；(b) 待 `@wdio/tauri-service` 修复 embedded provider 的窗口附着。在此修好前，`tests/review/smoke.spec.ts` 的 `#note-body` 断言会失败，属预期。

