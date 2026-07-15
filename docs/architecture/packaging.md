# 打包

发布前，`npm run tauri build` 的 `beforeBuildCommand` 会先执行 `npm run package:sidecar`，再构建前端和 sidecar TypeScript。

`sidecar/scripts/bundle.mjs` 将 sidecar 输出为 `sidecar/dist/floatnote-agent.mjs`。`prepare-tauri.mjs` 将 bundle 复制到 `src-tauri/resources/sidecar/`，并把 Node runtime 复制为符合 Tauri target triple 的 `src-tauri/binaries/floatnote-node-<triple>`。Tauri bundle 配置使用显式目录映射，将 sidecar bundle 与内置 skills 分别放到应用 `resource_dir()/sidecar` 和 `resource_dir()/skills`；Rust 从这些稳定的发布资源路径读取。Node runtime 作为 external binary 打包。

交叉构建时，必须提供与目标一致的：

```text
FLOATNOTE_TARGET_TRIPLE=<tauri target triple>
FLOATNOTE_NODE_RUNTIME=<matching Node executable>
```

发布 Rust 代码通过 `tauri-plugin-shell` 启动 external binary；debug 构建仍使用 sidecar 本地 `tsx`。因此发布工件必须在目标平台验证，不应以开发环境的全局 Node 成功作为发布依据。
