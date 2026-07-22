> [!NOTE]
> 这是使用 Developer ID 签名并经过 Apple 公证的 macOS 预览版。请只从本项目官方 GitHub Releases 下载。

- Apple Silicon（M1/M2/M3/M4 及后续芯片）请选择 `.dmg` 文件名包含 `aarch64` 的版本。
- Intel Mac 请选择 `.dmg` 文件名包含 `x86_64` 的版本。
- 发布工作流会在上传前验证应用签名、公证票据与 Gatekeeper 结果。新版本先创建 Draft；重新运行已有 Prerelease 时会直接替换同名产物。
