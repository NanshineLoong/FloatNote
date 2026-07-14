# 跨平台开发

FloatNote 面向 macOS 和 Windows。路径、文件监听、窗口行为与系统权限代码都必须在目标平台验证，不要把本机行为当作跨平台保证。

- 文件路径：前端拼接项目文件时保留原路径分隔符；Rust 使用 `Path`/`PathBuf`。现有测试覆盖 POSIX 和 Windows 路径。
- 文件监听：macOS FSEvent 与 Windows ReadDirectoryChangesW 的事件时序不同。原子保存必须先登记 self-write suppression，避免把自身写入当作外部变更。
- 系统功能：捕获、辅助功能、浏览器 attribution 与部分自动化能力有 macOS 实现或权限要求；代码必须保留 `cfg(target_os = ...)` 分支和非 macOS 回退。自动划词当前仅在 macOS 启用，使用独立 listen-only event tap 与 Accessibility；`shortcut` 模式不安装全局监听。设置页的选项统一写作“自动弹出”，非 macOS 通过说明文字明确能力边界。
- UI：设置窗口默认 `780 × 620`、最小 `720 × 520`，允许缩放和最大化。macOS 使用原生装饰与 Overlay 标题栏，38px 空白外壳区域可拖动并保留系统红绿灯；Windows 保留原生最小化、最大化与关闭控件，不模拟红绿灯。内容信息架构和卡片间距在两个平台一致。改动这些区域时，应在 macOS 与 Windows 各验证一次。
- 发布：sidecar Node runtime 必须与 target triple 匹配；不要把 macOS 构建机的 runtime 用于 Windows 包，反之亦然。
