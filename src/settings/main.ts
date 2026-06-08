import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

interface Config {
  working_dir: string | null;
  shortcut_capture: string;
  shortcut_toggle: string;
  font_size: number;
  launch_at_login: boolean;
}

const app = document.querySelector<HTMLElement>("#app")!;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[char];
  });
}

async function render() {
  const config = await invoke<Config>("get_config");
  app.innerHTML = `
    <div class="settings">
      <label>划线引用快捷键
        <input id="capture" value="${escapeHtml(config.shortcut_capture)}" />
      </label>
      <label>显示/隐藏快捷键
        <input id="toggle" value="${escapeHtml(config.shortcut_toggle)}" />
      </label>
      <label>字体大小
        <input id="font" type="number" min="10" max="28" value="${config.font_size}" />
      </label>
      <label class="row">
        <input id="autostart" type="checkbox" ${config.launch_at_login ? "checked" : ""} />
        开机自启动
      </label>
      <div id="err" class="err"></div>
      <button id="save">保存</button>
    </div>
  `;

  document.querySelector<HTMLButtonElement>("#save")!.onclick = async () => {
    const capture = document.querySelector<HTMLInputElement>("#capture")!.value.trim();
    const toggle = document.querySelector<HTMLInputElement>("#toggle")!.value.trim();
    const fontSize = Number.parseInt(document.querySelector<HTMLInputElement>("#font")!.value, 10);
    const launchAtLogin = document.querySelector<HTMLInputElement>("#autostart")!.checked;
    const errEl = document.querySelector<HTMLElement>("#err")!;
    errEl.textContent = "";

    try {
      await invoke("apply_shortcuts", { capture, toggle });
    } catch (error) {
      errEl.textContent = `快捷键无效或被占用：${error}`;
      return;
    }

    const newConfig: Config = {
      ...config,
      shortcut_capture: capture,
      shortcut_toggle: toggle,
      font_size: fontSize,
      launch_at_login: launchAtLogin,
    };
    await invoke("set_config", { newConfig });

    if (launchAtLogin) {
      if (!(await isEnabled())) await enable();
    } else if (await isEnabled()) {
      await disable();
    }

    errEl.textContent = "已保存";
  };
}

void render();

