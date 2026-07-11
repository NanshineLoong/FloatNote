import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ThemePreference = "system" | "light" | "dark";

export function applyAppearance(theme: ThemePreference, fontSize: number): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.setProperty("--fn-font-size", `${Math.min(28, Math.max(10, fontSize))}px`);
}

export async function initializeAppearance(): Promise<void> {
  try {
    const config = await invoke<{ theme?: ThemePreference; font_size?: number }>("get_config");
    applyAppearance(config.theme ?? "system", config.font_size ?? 15);
  } catch {
    applyAppearance("system", 15);
  }
  await listen<{ theme: ThemePreference; fontSize: number }>("appearance-changed", ({ payload }) => {
    applyAppearance(payload.theme, payload.fontSize);
  });
}
