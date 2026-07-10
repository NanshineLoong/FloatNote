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

文件系统删除测试在无 Finder/桌面会话的 CI 或沙箱中应使用可替换的 trash adapter；不要把 OS 自动化失败误判为领域逻辑回归。

