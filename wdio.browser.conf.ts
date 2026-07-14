import path from "node:path";
import { mkdirSync } from "node:fs";
import type { Options } from "@wdio/types";

const REVIEW_URL = "http://127.0.0.1:1422/tests/review/browser/assistant.html";
const ARTIFACTS = path.resolve("./artifacts/browser-review");

function ensureLoopbackNoProxy() {
  for (const name of ["NO_PROXY", "no_proxy"]) {
    const entries = new Set(
      (process.env[name] ?? "").split(",").map((entry) => entry.trim()).filter(Boolean),
    );
    entries.add("127.0.0.1");
    entries.add("localhost");
    process.env[name] = [...entries].join(",");
  }
}

ensureLoopbackNoProxy();
mkdirSync(ARTIFACTS, { recursive: true });

export const config: Options.Testrunner = {
  runner: "local",
  specs: ["./tests/review/browser/**/*.spec.ts"],
  maxInstances: 1,
  services: [
    [
      "@wdio/tauri-service",
      {
        mode: "browser",
        devServerUrl: REVIEW_URL,
        clearMocks: false,
      },
    ],
  ],
  capabilities: [{
    browserName: "tauri",
    browserVersion: "stable",
    "goog:chromeOptions": {
      args: ["--headless=new", "--window-size=640,240"],
    },
  }],
  logLevel: "error",
  waitforTimeout: 10_000,
  connectionRetryTimeout: 90_000,
  connectionRetryCount: 1,
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
  reporters: ["spec"],
  afterTest: async (_test, _context, result) => {
    if (result.passed) return;
    await browser.saveScreenshot(path.join(ARTIFACTS, `failure-${Date.now()}.png`)).catch(() => {});
  },
};
