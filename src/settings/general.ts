import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import type { Config, SaveConfig } from "./types";

interface AutostartDependencies {
  isEnabled: () => Promise<boolean>;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  save: () => Promise<void>;
}

export async function persistAutostart(enabled: boolean, dependencies: AutostartDependencies): Promise<void> {
  const wasEnabled = await dependencies.isEnabled();
  const changed = wasEnabled !== enabled;
  if (changed) await (enabled ? dependencies.enable() : dependencies.disable());
  try {
    await dependencies.save();
  } catch (saveError) {
    if (changed) {
      try {
        await (wasEnabled ? dependencies.enable() : dependencies.disable());
      } catch (rollbackError) {
        throw new Error(`${String(saveError)}；回滚开机启动状态失败：${String(rollbackError)}`);
      }
    }
    throw saveError;
  }
}

export function mountGeneralSettings(root: HTMLElement, config: Config, save: SaveConfig): void {
  root.innerHTML = `<div class="settings-card">
    <div class="settings-line">
      <div><label for="autostart"><strong>开机启动</strong></label><small>登录系统后自动打开 FloatNote</small></div>
      <label class="settings-toggle"><input id="autostart" type="checkbox" ${config.launch_at_login ? "checked" : ""} aria-describedby="autostart-error"/><span class="settings-toggle-track" aria-hidden="true"></span></label>
    </div>
    <p id="autostart-error" class="settings-inline-error" role="alert"></p>
  </div>`;
  const input = root.querySelector<HTMLInputElement>("#autostart")!;
  const error = root.querySelector<HTMLElement>("#autostart-error")!;
  input.addEventListener("change", async () => {
    const previous = config.launch_at_login;
    input.disabled = true;
    error.textContent = "";
    try {
      await persistAutostart(input.checked, { isEnabled, enable, disable, save });
      config.launch_at_login = input.checked;
    } catch (reason) {
      config.launch_at_login = previous;
      input.checked = previous;
      error.textContent = `无法更新开机启动：${String(reason)}`;
    } finally {
      input.disabled = false;
    }
  });
}
