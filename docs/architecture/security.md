# 安全边界

Rust/Tauri 是本地文件、窗口与 sidecar 权限的可信边界。WebView 和 Node sidecar 都不能绕过它直接取得任意用户文件写权限。

## 文件与图片

笔记写入、版本快照和删除经 Tauri command 进入 Rust。图片只能由 `floatnote-img://` 提供：Rust 会 canonicalize 路径，要求文件直接位于 `_assets/`，并要求扩展名属于允许的图片类型。已注册项目根目录之外的资源会被拒绝。

## AI 编辑

sidecar 的工具请求由 Rust 验证 target。编辑请求先成为 pending edit，并通过 `permission://request` 展示给用户；只有用户的 allow 决策会落盘。拒绝和无效 target 均会向 sidecar 回传结果，避免悬挂请求。

Agent 只可定位当前项目空间的 `inbox`、`tasks` 与 `piece`。`list_notes` 不接受目录参数；`create_note` 只接受标题，Rust 拒绝路径分隔符、`_` 前缀、目录穿越和同名覆盖。Loose root Markdown 不属于 Agent 能力边界。

## AI 网络读取

`web_search` 与 `web_fetch` 是可见但无需确认的只读工具。网页、搜索摘要和引用卡内容均是不可信资料，不能覆盖系统或用户指令。`web_fetch` 只允许 HTTP(S)，拒绝 URL 凭据、本机、私网、link-local 和非公网 IPv4/IPv6；每个重定向目标都会重新校验，并限制超时、重定向次数、响应类型、字节数和模型可见文本长度。

## WebView 与外链

CSP 在 `src-tauri/tauri.conf.json` 中限制脚本、连接、图片和字体来源，同时显式允许 Tauri IPC 与 `floatnote-img:`。`open_url` 在 Rust 侧复核 URL，仅接受 `http`、`https` 与 `mailto`，而不是信任 WebView 传入的任意 scheme。

## 划词捕获

macOS 划词需要 Accessibility 权限。全局 event tap 是 listen-only，并运行在
Tauri 主 RunLoop 之外，不能消费用户输入。剪贴板兜底仅定向发送给当前外部
前台 PID，绝不用于 FloatNote 自身；捕获后以 current-host-only 语义恢复每个
可读取的 pasteboard item/type。捕获期间前台 PID 改变时结果会被丢弃。
