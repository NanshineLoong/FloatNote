import { startNoteApp } from "./note-app";

// WebdriverIO 审查桥：仅当以 VITE_WDIO=1 构建时（npm run review:build）注入
// @wdio/tauri-plugin，让 @wdio/tauri-service 能在 webview 内执行 JS、读取 console
// 并管理窗口。release/普通构建下此分支被 tree-shake，不进产物。
if (import.meta.env.VITE_WDIO === "1") {
  void import("@wdio/tauri-plugin");
}

startNoteApp();

