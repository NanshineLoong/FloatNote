import type { WindowShortcutId } from "../shared/shortcuts";
import type { AiSettings } from "./provider-profiles";

export interface Config {
  shortcut_capture: string;
  shortcut_toggle: string;
  shortcut_popup: string;
  auto_popup_mode: string;
  launch_at_login: boolean;
  ai_settings: AiSettings;
  disabled_skills: string[];
  window_shortcuts: Record<WindowShortcutId, string>;
}

export type SaveConfig = () => Promise<void>;
