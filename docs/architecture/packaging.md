# 打包

发布前，`npm run tauri build` 的 `beforeBuildCommand` 会先执行 `npm run package:sidecar`，再构建前端和 sidecar TypeScript。macOS 默认 bundle target 是 `.dmg`，使用 hardened runtime 和 `Entitlements.plist`。根包的 Tauri 包装器在 macOS 上为打包进程提供一个范围受限的 `SetFile` shim：它只移除 Tauri 生成的 `.VolumeIcon.icns` 并清除卷的自定义图标标记，让 Finder 使用系统默认磁盘映像/卷图标；应用包仍使用 `src-tauri/icons/icon.icns`。发布工作流通过同一包装器构建，然后完成 Developer ID 签名、公证和验证。

`sidecar/scripts/bundle.mjs` 将 sidecar 输出为 `sidecar/dist/floatnote-agent.mjs`。`prepare-tauri.mjs` 将 bundle 复制到 `src-tauri/resources/sidecar/`，并把 Node runtime 复制为符合 Tauri target triple 的 `src-tauri/binaries/floatnote-node-<triple>`。Tauri bundle 配置使用显式目录映射，将 sidecar bundle 与内置 skills 分别放到应用 `resource_dir()/sidecar` 和 `resource_dir()/skills`；Rust 从这些稳定的发布资源路径读取。Node runtime 作为 external binary 打包。

Tauri 的增量资源复制可能在 `target` 或旧 bundle 中留下已从源码删除的 Skill
目录。Rust 只枚举当前内置 Skill ID 清单并向 sidecar 下发对应的具体 Skill 目录，
因此陈旧副本不会在运行时复活；debug 模式直接使用源码 Skill 目录。

交叉构建时，必须提供与目标一致的：

```text
FLOATNOTE_TARGET_TRIPLE=<tauri target triple>
FLOATNOTE_NODE_RUNTIME=<matching Node executable>
```

发布 Rust 代码通过 `tauri-plugin-shell` 启动 external binary；debug 构建仍使用 sidecar 本地 `tsx`。因此发布工件必须在目标平台验证，不应以开发环境的全局 Node 成功作为发布依据。

GitHub Release 工作流不交叉复用 Node runtime：Apple Silicon 在 `macos-15` runner 上构建 `aarch64-apple-darwin`，Intel 在 `macos-15-intel` runner 上构建 `x86_64-apple-darwin`。`prepare-tauri.mjs` 使用当前 Node 进程作为 runtime，因此 runner、Rust target 和 bundled Node 三者必须保持同一架构。

应用版本以根 `package.json` 为唯一来源；Tauri 配置通过 `"version": "../package.json"` 读取它。`scripts/release-version.mjs` 同步 Cargo、workspace package 和 lockfile 中的版本副本，并在发布前校验 Git 标签。
