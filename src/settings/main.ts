import { invoke } from "@tauri-apps/api/core";
import { initializeAppearance } from "../shared/appearance";
import { createEmptyAiSettings } from "./provider-profiles";
import { mountProviderSettings } from "./provider-settings";
import { mountGeneralSettings } from "./general";
import { mountSkills } from "./skills";
import { mountShortcutSettings } from "./shortcuts";
import { mountTabs, settingsShellMarkup } from "./shell";
import type { Config } from "./types";

const app = document.querySelector<HTMLElement>("#app")!;

async function render(): Promise<void> {
  initializeAppearance();
  try {
    const config = await invoke<Config>("get_config");
    config.disabled_skills ??= [];
    config.ai_settings ??= createEmptyAiSettings();
    app.innerHTML = settingsShellMarkup();
    mountTabs(app);
    const save = () => invoke<void>("set_config", { newConfig: config });
    mountGeneralSettings(app.querySelector<HTMLElement>("#general-settings")!, config, save);
    mountProviderSettings(app.querySelector<HTMLElement>("#provider-settings")!, config.ai_settings, {
      saveProvider: (providerId, providerConfig) => invoke("save_ai_provider", { providerId, providerConfig }),
      setActiveProvider: (providerId) => invoke("set_active_ai_provider", { providerId }),
    });
    mountSkills(
      app.querySelector<HTMLElement>("#skills")!,
      app.querySelector<HTMLButtonElement>("#import-skill")!,
      app.querySelector<HTMLElement>("#skills-notice")!,
      config,
      save,
    );
    mountShortcutSettings(app.querySelector<HTMLElement>("#shortcut-settings")!, config);
  } catch (reason) {
    app.innerHTML = `<main class="settings-load-error" role="alert"><strong>无法载入设置</strong><p>${String(reason)}</p><button type="button" id="retry-settings">重试</button></main>`;
    app.querySelector<HTMLButtonElement>("#retry-settings")!.onclick = () => void render();
  }
}

void render();
