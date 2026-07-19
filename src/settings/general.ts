import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { applyAppearance, type Theme } from "../shared/appearance";
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
      <div><label for="theme"><strong>外观</strong></label><small>切换浅色或深色外观</small></div>
      <span class="select-wrap"><select id="theme" class="fn-control" aria-describedby="theme-error"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></span>
    </div>
    <p id="theme-error" class="settings-inline-error" role="alert"></p>
    <div class="settings-line">
      <div><label for="autostart"><strong>开机启动</strong></label><small>登录系统后自动打开 FloatNote</small></div>
      <label class="settings-toggle"><input id="autostart" type="checkbox" ${config.launch_at_login ? "checked" : ""} aria-describedby="autostart-error"/><span class="settings-toggle-track" aria-hidden="true"></span></label>
    </div>
    <p id="autostart-error" class="settings-inline-error" role="alert"></p>
  </div>`;
  const input = root.querySelector<HTMLInputElement>("#autostart")!;
  const error = root.querySelector<HTMLElement>("#autostart-error")!;
  const theme = root.querySelector<HTMLSelectElement>("#theme")!;
  const themeError = root.querySelector<HTMLElement>("#theme-error")!;
  theme.value = config.theme;
  theme.addEventListener("change", async () => {
    const previous = config.theme;
    const selected = theme.value as Theme;
    theme.disabled = true;
    themeError.textContent = "";
    applyAppearance(selected);
    config.theme = selected;
    try {
      await save();
    } catch (reason) {
      config.theme = previous;
      theme.value = previous;
      applyAppearance(previous);
      themeError.textContent = `无法更新外观：${String(reason)}`;
    } finally {
      theme.disabled = false;
    }
  });
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
