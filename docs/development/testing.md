# 测试与质量门禁

| 命令 | 覆盖范围 |
| --- | --- |
| `npm run test:frontend` | 前端与 shared 纯逻辑 Vitest 测试 |
| `npm run test:infra` | review 编排、WebDriver 探针和配置隔离测试 |
| `npm run test:sidecar` | sidecar protocol、工具和发布路径测试 |
| `npm run build:frontend` | TypeScript 类型检查与 Vite MPA 构建 |
| `npm run build:sidecar` | sidecar TypeScript 编译 |
| `npm run smoke:sidecar` | ESM bundle 的 JSONL ready 握手 |
| `npm run check` | 全部 JS/TS 测试、构建与 sidecar smoke |
| `cargo test --lib` | Rust 领域、协议和 adapter 单测 |
| `cargo check --release` | 发布分支（包括 external sidecar 启动路径）编译 |
| `npm run review:ui` | Chrome 中挂载真实前端组件，回归 UI 与交互状态 |
| `npm run review:native:doctor` | 从当前源码启动 Tauri dev，探测 embedded WebDriver 状态和会话生命周期 |

文件系统删除测试在无 Finder/桌面会话的 CI 或沙箱中应使用可替换的 trash adapter；不要把 OS 自动化失败误判为领域逻辑回归。

## 浏览器 UI 回归

`npm run review:ui` 自动启动或复用 Vite，再由 WebdriverIO browser mode 驱动托管的 Chrome。`tests/review/browser/assistant-fixture.ts` 直接挂载生产 `mountAssistant` 和生产 CSS，只在 Tauri IPC 边界使用 browser-mode mock；不复制组件实现，也不需要 Tauri binary 或 `.app`。

- spec 位于 `tests/review/browser/`，配置见 `wdio.browser.conf.ts`；失败截图写入 `artifacts/browser-review/`。
- 适合验证 DOM、计算样式、焦点、动画前后状态和前端 IPC 参数；不用于证明 Rust、真实 webview 或系统窗口行为。
- 编排脚本自动管理 Vite 生命周期，并把 `127.0.0.1,localhost` 加入 `NO_PROXY` 与 `no_proxy`。Chrome 与匹配 driver 由 WebdriverIO 管理和缓存，不依赖仓库里的裸 binary。
- Computer Use 不作为自动化测试依赖。辅助功能、全局快捷键等 OS 集成优先用单元/集成测试覆盖边界，必要时再做人工验收。

## 原生运行时诊断

`npm run review:native:doctor` 只诊断原生测试通道：它执行当前工作树的 `tauri dev --no-watch --features e2e-wdio`，等待 `GET /status`，创建绑定 `main` 窗口的 WebDriver 会话，再删除会话。原始 stdout/stderr 保存在 `artifacts/native-doctor/<timestamp>/`，失败信息会给出对应目录。

- `tauri-plugin-wdio` 与 `tauri-plugin-wdio-webdriver` 是可选依赖，只在 debug + `e2e-wdio` feature 下注册。
- `wdio:default` 只在 `tauri.review.conf.json` 内联启用，普通 dev/release 使用的 `default` capability 与默认扫描目录都不包含测试权限。
- `src-tauri/tauri.review.conf.json` 只供这条显式诊断命令使用；普通配置仍保持 `withGlobalTauri: false`。
- 这条命令验证启动、端口和协议握手，不承担产品 UI 回归；UI 回归由更快、更稳定的 browser mode 完成。

## 排错

如果 `/status` 已 ready，但 `POST /session` 报 `UND_ERR_SOCKET`、连接重置或 4445 很快关闭，先检查代理环境。WebDriver 客户端会读取 `HTTP_PROXY/HTTPS_PROXY`；本地地址未进入 `NO_PROXY/no_proxy` 时，会话请求可能错误地经过代理。两条 review 命令已自动补齐 loopback 排除项。

升级 `@wdio/tauri-service` 时，应重新验证 browser mode、embedded session 和 `@wdio/native-utils` override；不要恢复依赖 `src-tauri/target/debug/floatnote` 的独立运行脚本，因为它无法保证对应当前源码。

## Agent 虚拟工作区的跨平台证据

当前自动化覆盖 Windows 风格反斜杠与盘符绝对路径拒绝、路径大小写/文件名规则、CRLF clean Markdown 搜索，以及 create-only/同名竞态。macOS 上的完整 Rust、sidecar 和浏览器 UI 门禁通过不代表 Windows 原生 UI 已验证。

Windows 发布前仍需人工复核：project picker 与 active-note 路径、Skill 目录 realpath、审批弹窗、piece create/rewrite/snapshot、外部编辑造成的 stale commit、watcher 自写抑制，以及 packaged sidecar 的启动与退出。
