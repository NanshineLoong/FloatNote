# 发布流程

FloatNote 的 macOS 预览版由 GitHub Actions 构建。推送版本标签后，工作流分别在原生 Apple Silicon 与 Intel runner 上构建 `.dmg`，并创建 Draft、Prerelease GitHub Release。当前产物使用 ad-hoc 签名，尚未经过 Apple 公证。

## 日常验证

`.github/workflows/ci.yml` 在推送 `main` 和 Pull Request 时运行：

- `npm ci`、`npm run version:check`、`npm run check`；
- macOS 与 Windows 上的 `cargo test --lib`、`cargo check` 和 `cargo check --release`。

## 准备版本

根 `package.json` 是应用版本的唯一来源，`src-tauri/tauri.conf.json` 直接读取它。Cargo、workspace package 和 lockfile 中仍需保留相同版本，由脚本统一维护：

```bash
npm run version:set -- 0.2.0
npm run version:check
```

检查版本改动和发布内容，运行完整验证，然后提交：

```bash
npm run check
cd src-tauri
cargo test --lib
cargo check
cargo check --release
```

回到仓库根目录，创建与项目版本完全一致的 `v` 前缀标签：

```bash
git tag v0.2.0
git push origin main
git push origin v0.2.0
```

`release.yml` 会校验 `v0.2.0` 与项目版本 `0.2.0` 是否一致；不一致时不会构建或创建 Release。也可以在 GitHub Actions 页面手动运行该工作流，但输入必须是已经存在的版本标签。

## 审核 Draft Release

`prepare_release` job 会先验证标签、创建或复用同一个 Draft Release，再把 Release ID 交给两个构建任务，避免并行构建竞相创建 Release。两个构建任务分别上传：

- `aarch64`：Apple Silicon 的 `.dmg` 和 `.app.tar.gz`；
- `x86_64`：Intel Mac 的 `.dmg` 和 `.app.tar.gz`。

普通用户应下载 `.dmg`；`.app.tar.gz` 是 `tauri-action` 同时保留的应用归档。

GitHub 自动生成提交记录；工作流会在正文顶部加入未公证警告、架构选择和首次运行说明。公开前应人工补充或整理以下内容：

```markdown
## 新功能
- ...

## 修复
- ...

## 已知问题
- 当前 macOS 构建尚未经过 Apple 公证。
- Windows 安装包仍在准备中。
```

至少下载并验证当前机器对应的 `.dmg`：

1. 在未安装 Node 的干净用户环境中安装 FloatNote；
2. 按 README 的“隐私与安全性 → 仍要打开”流程首次启动；
3. 确认 agent status ready，发送一条只读对话；
4. 确认写入权限气泡和应用写入；
5. 重启后确认聊天恢复。

确认 Release 标题、说明、两种架构的 `.dmg`/应用归档和测试结果后，再在 GitHub 将 Draft 发布。因为当前属于未公证预览版，应保留 Prerelease 标记。

## 本地打包

使用与目标平台匹配的 Node 22.19+ 和 Rust toolchain，执行：

```bash
npm ci
npm run tauri build
```

Tauri 的 `beforeBuildCommand` 会生成 sidecar resource 和 external Node runtime。Node runtime 来自执行构建的 Node 进程，因此本地构建也必须在目标架构机器上进行，或者显式提供匹配目标的 `FLOATNOTE_NODE_RUNTIME` 与 `FLOATNOTE_TARGET_TRIPLE`。

## 将来启用 Apple 公证

获得 Developer ID Application 证书后，可以通过 CI secrets 设置 `APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_SIGNING_IDENTITY` 以及 Apple 公证凭据。环境变量中的正式签名身份会覆盖当前配置的 `-`。external Node runtime 必须继续与应用一起签名，`Entitlements.plist` 中供 V8 JIT 使用的权限不得移除。
