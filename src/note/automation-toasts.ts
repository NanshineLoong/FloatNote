import { listen } from "@tauri-apps/api/event";
import { showToast } from "../shared/toast";

/** 订阅权限/自动化相关提示事件：macOS 后端触发，窗内只给简短 toast，
 * 不污染正文区。30 秒内对 automation-needed 去重，避免重复打扰。 */
export function attachAutomationToasts() {
  void listen("accessibility-needed", () => {
    // macOS 已由后端弹过一次系统授权框；这里只在窗内给一条简短提示，
    // 不再往 #note-body 正文区塞横幅（避免污染编辑器内容）。
    showToast("需开启「辅助功能」权限后重试");
  });

  let lastAutomationToastAt = 0;

  void listen("automation-needed", () => {
    // 后端识别到当前前台是已知浏览器，但 osascript 读不到标签页 URL/标题
    // （macOS 自动化权限未授/被拒/超时）。提示用户去授权，授权后即可恢复
    // 网址+标题捕获；本条引用仍会以"仅 app 名"落地。
    const now = Date.now();
    if (now - lastAutomationToastAt < 30_000) return;
    lastAutomationToastAt = now;
    showToast("浏览器授权未完成，已先保存为应用来源；授权后重试即可");
  });
}
