# 发布流程

1. 使用与目标平台匹配的 Node 22.19+ 和 Rust toolchain。
2. 运行 `npm install`，然后 `npm run check`。
3. 运行 `(cd src-tauri && cargo test --lib && cargo check --release)`。
4. 执行 `npm run tauri build`。Tauri 的 `beforeBuildCommand` 会生成 sidecar resource 和 external Node runtime。
5. 在未安装 Node 的干净 macOS/Windows 虚拟机上启动 App，确认 agent status ready、发送一条只读对话、确认写入权限气泡、重启后恢复聊天。
6. 进行平台签名与 notarization 后再发布；external Node runtime 必须与应用一起签名。macOS 的 `Entitlements.plist` 已授予 bundled Node 所需的 V8 JIT 内存权限，签名时不得移除。
