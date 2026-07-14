import type { Config } from "./types";
import { escapeHtml } from "../shared/escape";

export type AssistantOutputMode = "compact" | "detailed";

export function mountOutputMode(
  root: HTMLElement,
  config: Pick<Config, "assistant_output_mode">,
  save: (mode: AssistantOutputMode) => Promise<void>,
): void {
  let busy = false;
  let error = "";
  const render = () => {
    const mode = config.assistant_output_mode === "detailed" ? "detailed" : "compact";
    root.innerHTML = `<div class="settings-card output-mode-card">
      <label class="output-mode-option"><input type="radio" name="assistant-output-mode" value="compact" ${mode === "compact" ? "checked" : ""} ${busy ? "disabled" : ""}/><span><strong>简洁</strong><small>只显示正式内容，以光标表示隐藏过程仍在进行。</small></span></label>
      <label class="output-mode-option"><input type="radio" name="assistant-output-mode" value="detailed" ${mode === "detailed" ? "checked" : ""} ${busy ? "disabled" : ""}/><span><strong>详细</strong><small>显示思考和工具过程，并标示正在运行的步骤。</small></span></label>
      <p class="settings-inline-error" role="alert">${escapeHtml(error)}</p>
    </div>`;
    root.querySelectorAll<HTMLInputElement>('input[name="assistant-output-mode"]').forEach((input) => {
      input.onchange = () => {
        if (input.checked && !busy) void change(input.value as AssistantOutputMode);
      };
    });
  };
  const change = async (next: AssistantOutputMode) => {
    const previous = config.assistant_output_mode;
    config.assistant_output_mode = next;
    busy = true;
    error = "";
    render();
    try {
      await save(next);
    } catch (reason) {
      config.assistant_output_mode = previous;
      error = reason instanceof Error ? reason.message : String(reason);
    } finally {
      busy = false;
      render();
    }
  };
  render();
}
