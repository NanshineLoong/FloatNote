import assert from "node:assert/strict";
import path from "node:path";

const ARTIFACTS = path.resolve("./artifacts");

// FloatNote 冒烟审查（从新用户视角）。
//
// 日志捕获由 wdio.conf.ts 的 captureBackendLogs/captureFrontendLogs 接管，
// 跑完后 reporter 里会带 [Tauri:Backend] / [Tauri:Frontend] 行，无需这里显式读。

describe("FloatNote 冒烟审查", () => {
  before(async () => {
    // main 窗口默认 visible:false（点托盘/快捷键才显示）。审查时主动拉起，便于截图与交互。
    await showMainWindow();
  });

  it("启动后渲染主框架（#note-body 存在）", async () => {
    const noteBody = await $("#note-body");
    await noteBody.waitForExist({ timeout: 30000 });
    await browser.saveScreenshot(path.join(ARTIFACTS, "boot.png"));
    assert.ok(await noteBody.isExisting(), "主框架 #note-body 未渲染，应用未正常启动");
  });

  it("启动期不应出现错误横幅 (role=alert)", async () => {
    const alert = await $('[role="alert"]');
    const hasAlert = await alert.isExisting();
    if (hasAlert) {
      const txt = await alert.getText().catch(() => "<no text>");
      assert.fail(`启动期出现错误横幅：${txt}`);
    }
    assert.ok(!hasAlert);
  });

  // TODO（新用户深流程，后续 spec 展开）：
  // 1. 创建项目 —— 涉及原生 Tauri 目录选择对话框，WebDriver 不能直接驱动，
  //    需用 @wdio/tauri-plugin 的 IPC mock 预置项目目录后，再走 UI 断言列表项出现。
  // 2. 修改设置 —— 切到 settings 窗口（browser.switchToWindow），改值，断言持久化。
  // 3. 重启验证持久化 —— 关闭并重新 attach 会话，断言数据保留。
  // 这些流程依赖 IPC mock 与多窗口切换，单独立 spec 文件实现，避免冒烟 spec 膨胀。
});

// 主动显示 main 窗口：review 构建开了 withGlobalTauri，webview 内有 window.__TAURI__.core。
// 失败不致命：若该窗口已被应用逻辑显示，调用多余但不影响后续交互。
async function showMainWindow(): Promise<void> {
  try {
    await browser.execute(() => {
      const core = (window as unknown as { __TAURI__?: { core?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> } } }).__TAURI__?.core;
      if (core && typeof core.invoke === "function") {
        void core.invoke("plugin:window|show", { label: "main" });
      }
    });
  } catch (error) {
    console.warn("[review] show main window 失败（若窗口已可见可忽略）：", error);
  }
}
