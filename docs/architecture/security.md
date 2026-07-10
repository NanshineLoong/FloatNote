# 安全边界

Rust/Tauri 是本地文件、窗口与 sidecar 权限的可信边界。WebView 和 Node sidecar 都不能绕过它直接取得任意用户文件写权限。

## 文件与图片

笔记写入、版本快照和删除经 Tauri command 进入 Rust。图片只能由 `floatnote-img://` 提供：Rust 会 canonicalize 路径，要求文件直接位于 `_assets/`，并要求扩展名属于允许的图片类型。已注册项目根目录之外的资源会被拒绝。

## AI 编辑

sidecar 的工具请求由 Rust 验证 target。编辑请求先成为 pending edit，并通过 `permission://request` 展示给用户；只有用户的 allow 决策会落盘。拒绝和无效 target 均会向 sidecar 回传结果，避免悬挂请求。

## WebView 与外链

CSP 在 `src-tauri/tauri.conf.json` 中限制脚本、连接、图片和字体来源，同时显式允许 Tauri IPC 与 `floatnote-img:`。`open_url` 在 Rust 侧复核 URL，仅接受 `http`、`https` 与 `mailto`，而不是信任 WebView 传入的任意 scheme。
