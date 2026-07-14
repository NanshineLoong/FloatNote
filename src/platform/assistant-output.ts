import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AssistantOutputMode = "compact" | "detailed";

export function normalizeAssistantOutputMode(value: unknown): AssistantOutputMode {
  return value === "detailed" ? "detailed" : "compact";
}

export async function getAssistantOutputMode(): Promise<AssistantOutputMode> {
  const config = await invoke<{ assistant_output_mode?: unknown }>("get_config");
  return normalizeAssistantOutputMode(config.assistant_output_mode);
}

export function onAssistantOutputModeChanged(
  callback: (mode: AssistantOutputMode) => void,
): Promise<UnlistenFn> {
  return listen<unknown>("assistant-output-mode-changed", (event) =>
    callback(normalizeAssistantOutputMode(event.payload)));
}
