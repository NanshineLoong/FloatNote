import path from "node:path";
import type { Options } from "@wdio/types";

// FloatNote 审查配置：通过 @wdio/tauri-service 驱动真正的 debug 构建，
// 以用户视角操作 webview，同时捕获前端 console 与 Rust stdout 日志。
//
// 前置：先 `npm run review:build` 产出 src-tauri/target/debug/floatnote。
// 运行：`npm run review:app`。

const APP_BINARY = path.resolve("./src-tauri/target/debug/floatnote");
const ARTIFACTS = path.resolve("./artifacts");

export const config: Options.Testrunner = {
  runner: "local",
  specs: ["./tests/review/**/*.spec.ts"],
  exclude: [],
  maxInstances: 1,

  services: [
    [
      "@wdio/tauri-service",
      {
        // binary 由 capabilities.tauri:options.application 掹定，这里显式兜底。
        appBinaryPath: APP_BINARY,
        // macOS 内嵌 WebDriver，不依赖系统 safaridriver；
        // Windows/Linux 也可设 'embedded'，或改 'official' 用 cargo 装的 tauri-driver。
        driverProvider: "embedded",
        // 捕获 Rust stdout + webview console，进入 reporter（带 [Tauri:Backend]/[Tauri:Frontend] 标记）。
        captureBackendLogs: true,
        captureFrontendLogs: true,
        backendLogLevel: "debug",
        frontendLogLevel: "debug",
        // 多窗口里默认驱动 main；切窗见 spec 中的 switchToWindow。
        windowLabel: "main",
        startTimeout: 90000,
      },
    ],
  ],

  capabilities: [
    {
      maxInstances: 1,
      browserName: "tauri",
      "tauri:options": {
        application: APP_BINARY,
      },
    },
  ],

  logLevel: "info",
  bail: 0,
  baseUrl: "http://127.0.0.1:4444",
  waitforTimeout: 15000,
  connectionRetryTimeout: 90000,
  connectionRetryCount: 3,

  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120000,
  },

  reporters: ["spec"],

  // 每步交互后存证。
  afterTest: async () => {
    try {
      await browser.saveScreenshot(path.join(ARTIFACTS, `step-${Date.now()}.png`));
    } catch {
      /* 截图失败不阻塞断言 */
    }
  },
};
