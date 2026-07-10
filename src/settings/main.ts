import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { KeyRecorder } from "./key-recorder";
import {
  WINDOW_SHORTCUT_IDS,
  WINDOW_SHORTCUT_DEFAULTS,
  WINDOW_SHORTCUT_LABELS,
  findAllConflicts,
  type WindowShortcutId,
} from "../shared/shortcuts";
import { escapeHtml } from "../shared/escape";
import { createIcon } from "../shared/ui/icon";
import { createButton } from "../shared/ui/button";

/** 设置页 id'd 按钮：用 createButton 出骨架并设 id，onclick 由 main.ts 按 id 绑定。 */
function settingsButton(id: string, opts: Parameters<typeof createButton>[0]): string {
  const btn = createButton(opts);
  btn.id = id;
  return btn.outerHTML;
}

interface Config {
  working_dir: string | null;
  shortcut_capture: string;
  shortcut_toggle: string;
  shortcut_popup: string;
  auto_popup_mode: string;
  piece_outline_default: boolean;
  font_size: number;
  launch_at_login: boolean;
  ai_provider: string;
  ai_model: string;
  ai_api_key: string;
  ai_base_url: string;
  window_shortcuts: {
    assistant: string;
    assistant_bubble: string;
    action_panel: string;
    add_action: string;
    new_conversation: string;
    view_inbox: string;
    view_piece: string;
    view_split: string;
  };
}

const app = document.querySelector<HTMLElement>("#app")!;

async function render() {
  const config = await invoke<Config>("get_config");

  // 迁移：旧版 "custom" provider 映射为 "openai"
  if (config.ai_provider === "custom") {
    config.ai_provider = "openai";
  }

  app.innerHTML = `
    <div class="settings-page">

      <!-- ── 通用 ── -->
      <section class="settings-section">
        <div class="settings-section-header">
          ${createIcon({ phosphor: "ph ph-gear" }).outerHTML}
          <span>通用</span>
        </div>

        <div class="settings-row settings-row-inline">
          <label class="settings-label">开机自启动</label>
          <label class="settings-toggle">
            <input id="autostart" type="checkbox" ${config.launch_at_login ? "checked" : ""} />
            <span class="settings-toggle-track"></span>
          </label>
        </div>

        <div class="settings-row settings-row-inline">
          <label class="settings-label">写作区默认大纲模式</label>
          <label class="settings-toggle">
            <input id="piece-outline-default" type="checkbox" ${config.piece_outline_default ? "checked" : ""} />
            <span class="settings-toggle-track"></span>
          </label>
        </div>
      </section>

      <!-- ── 快捷键 ── -->
      <section class="settings-section">
        <div class="settings-section-header">
          ${createIcon({ phosphor: "ph ph-keyboard" }).outerHTML}
          <span>快捷键</span>
        </div>

        <div class="settings-row">
          <label class="settings-label">划线引用</label>
          <div id="recorder-capture" class="key-recorder" tabindex="0">
            <span class="key-recorder-label">${escapeHtml(config.shortcut_capture)}</span>
          </div>
        </div>

        <div class="settings-row">
          <label class="settings-label">显示/隐藏</label>
          <div id="recorder-toggle" class="key-recorder" tabindex="0">
            <span class="key-recorder-label">${escapeHtml(config.shortcut_toggle)}</span>
          </div>
        </div>

        <div class="settings-row">
          <label class="settings-label">划词弹窗</label>
          <div id="recorder-popup" class="key-recorder" tabindex="0">
            <span class="key-recorder-label">${escapeHtml(config.shortcut_popup)}</span>
          </div>
        </div>

        <div class="settings-row">
          <label class="settings-label">划词悬浮窗自动触发</label>
          <select id="auto-popup-mode" class="settings-select">
            <option value="off" ${(config.auto_popup_mode ?? "off") === "off" ? "selected" : ""}>关闭</option>
            <option value="every" ${config.auto_popup_mode === "every" ? "selected" : ""}>每次选中弹出</option>
            <option value="modifier" ${config.auto_popup_mode === "modifier" ? "selected" : ""}>按住 ⌥ 选中时弹出</option>
          </select>
        </div>
      </section>

      <!-- ── 窗口快捷键 ── -->
      <section class="settings-section">
        <div class="settings-section-header">
          ${createIcon({ phosphor: "ph ph-keyboard" }).outerHTML}
          <span>窗口快捷键</span>
        </div>
        ${WINDOW_SHORTCUT_IDS.map((id) => `
        <div class="settings-row">
          <label class="settings-label">${WINDOW_SHORTCUT_LABELS[id]}</label>
          <div id="recorder-${id}" class="key-recorder" tabindex="0">
            <span class="key-recorder-label">${escapeHtml(config.window_shortcuts?.[id] ?? WINDOW_SHORTCUT_DEFAULTS[id])}</span>
          </div>
          <span class="settings-conflict" data-conflict-for="${id}"></span>
        </div>
        `).join("")}
        <div class="settings-row settings-row-inline">
          ${settingsButton("restore-shortcuts", { variant: "secondary", label: "恢复默认" })}
        </div>
      </section>

      <!-- ── AI 助手 ── -->
      <section class="settings-section">
        <div class="settings-section-header">
          ${createIcon({ phosphor: "ph ph-brain" }).outerHTML}
          <span>AI 助手</span>
        </div>

        <div class="settings-row">
          <label class="settings-label">服务商</label>
          <select id="ai-provider" class="settings-select">
            <option value="">未配置</option>
            <option value="anthropic" ${config.ai_provider === "anthropic" ? "selected" : ""}>Anthropic</option>
            <option value="openai" ${config.ai_provider === "openai" ? "selected" : ""}>OpenAI</option>
            <option value="google" ${config.ai_provider === "google" ? "selected" : ""}>Google</option>
          </select>
        </div>

        <div class="settings-row" id="ai-model-row">
          <label class="settings-label">模型</label>
          <input id="ai-model" type="text"
            placeholder="${modelPlaceholder(config.ai_provider)}"
            value="${escapeHtml(config.ai_model)}" />
        </div>

        <div class="settings-row" id="ai-key-row">
          <label class="settings-label">API 密钥</label>
          <input id="ai-api-key" type="password"
            placeholder="sk-..."
            value="${escapeHtml(config.ai_api_key)}" />
        </div>

        <div class="settings-row" id="base-url-row">
          <label class="settings-label">自定义地址</label>
          <input id="ai-base-url" type="text"
            placeholder="${baseUrlPlaceholder(config.ai_provider)}"
            value="${escapeHtml(config.ai_base_url)}" />
        </div>
      </section>

      <!-- ── Footer ── -->
      <div class="settings-footer">
        <span id="settings-status" class="settings-status"></span>
        ${settingsButton("save-btn", { variant: "primary", label: "保存" })}
      </div>
    </div>
  `;

  // ── 初始化快捷键录制器 ──
  const captureRecorder = new KeyRecorder(
    document.querySelector("#recorder-capture")!,
    config.shortcut_capture,
    recomputeConflicts,
  );
  const toggleRecorder = new KeyRecorder(
    document.querySelector("#recorder-toggle")!,
    config.shortcut_toggle,
    recomputeConflicts,
  );
  const popupRecorder = new KeyRecorder(
    document.querySelector("#recorder-popup")!,
    config.shortcut_popup,
    recomputeConflicts,
  );
  const autoPopupSelect = document.querySelector<HTMLSelectElement>("#auto-popup-mode")!;

  // ── 窗口快捷键录制器 ──
  const windowRecorders: Partial<Record<WindowShortcutId, KeyRecorder>> = {};
  for (const id of WINDOW_SHORTCUT_IDS) {
    const el = document.querySelector<HTMLElement>(`#recorder-${id}`)!;
    windowRecorders[id] = new KeyRecorder(el, config.window_shortcuts?.[id] ?? WINDOW_SHORTCUT_DEFAULTS[id], recomputeConflicts);
  }

  function recomputeConflicts() {
    const all = {} as Record<WindowShortcutId, string>;
    for (const id of WINDOW_SHORTCUT_IDS) {
      all[id] = windowRecorders[id]!.value;
    }
    const globals = { capture: captureRecorder.value, toggle: toggleRecorder.value, popup: popupRecorder.value };
    const conflicts = findAllConflicts(all, globals);
    let hasConflict = false;
    for (const id of WINDOW_SHORTCUT_IDS) {
      const span = document.querySelector<HTMLElement>(`[data-conflict-for="${id}"]`)!;
      const r = conflicts[id];
      if (r) {
        hasConflict = true;
        span.textContent = `⚠ ${r.message}`;
        span.classList.add("error");
      } else {
        span.textContent = "";
        span.classList.remove("error");
      }
    }
    // 全局录制器变化也可能引入冲突（window↔global），上面 findAllConflicts 已覆盖；
    // 这里再禁用保存。
    const saveBtn = document.querySelector<HTMLButtonElement>("#save-btn")!;
    saveBtn.disabled = hasConflict;
  }

  recomputeConflicts();

  // ── AI provider 切换 ──
  const providerSelect = document.querySelector<HTMLSelectElement>("#ai-provider")!;
  const baseUrlRow = document.querySelector<HTMLElement>("#base-url-row")!;
  const modelInput = document.querySelector<HTMLInputElement>("#ai-model")!;
  const baseUrlInput = document.querySelector<HTMLInputElement>("#ai-base-url")!;
  providerSelect.onchange = () => {
    const v = providerSelect.value;
    baseUrlRow.hidden = !supportsBaseUrl(v);
    modelInput.placeholder = modelPlaceholder(v);
    baseUrlInput.placeholder = baseUrlPlaceholder(v);
  };

  // ── 恢复默认窗口快捷键 ──
  document.querySelector<HTMLButtonElement>("#restore-shortcuts")!.onclick = () => {
    for (const id of WINDOW_SHORTCUT_IDS) {
      windowRecorders[id]!.value = WINDOW_SHORTCUT_DEFAULTS[id];
    }
    recomputeConflicts();
  };

  // ── 保存 ──
  document.querySelector<HTMLButtonElement>("#save-btn")!.onclick = async () => {
    const statusEl = document.querySelector<HTMLElement>("#settings-status")!;
    statusEl.textContent = "";
    statusEl.className = "settings-status";

    const capture = captureRecorder.value;
    const toggle = toggleRecorder.value;
    const popup = popupRecorder.value;
    const autoPopupMode = autoPopupSelect.value;
    const windowShortcuts = {} as Record<WindowShortcutId, string>;
    for (const id of WINDOW_SHORTCUT_IDS) {
      windowShortcuts[id] = windowRecorders[id]!.value;
    }

    // 1. 验证快捷键
    try {
      await invoke("apply_shortcuts", { capture, toggle, popup, windowShortcuts });
    } catch (error) {
      statusEl.textContent = `快捷键无效或被占用：${error}`;
      statusEl.classList.add("error");
      return;
    }

    // 2. 构建完整配置（保留工作目录和字号的现有值）
    const newConfig: Config = {
      ...config,
      shortcut_capture: capture,
      shortcut_toggle: toggle,
      shortcut_popup: popup,
      auto_popup_mode: autoPopupMode,
      piece_outline_default: document.querySelector<HTMLInputElement>("#piece-outline-default")!.checked,
      launch_at_login: document.querySelector<HTMLInputElement>("#autostart")!.checked,
      ai_provider: providerSelect.value,
      ai_model: modelInput.value.trim(),
      ai_api_key: document.querySelector<HTMLInputElement>("#ai-api-key")!.value.trim(),
      ai_base_url: document.querySelector<HTMLInputElement>("#ai-base-url")!.value.trim(),
      window_shortcuts: windowShortcuts,
    };

    const aiConfigError = validateAiConfig(newConfig);
    if (aiConfigError) {
      statusEl.textContent = aiConfigError;
      statusEl.classList.add("error");
      return;
    }

    // 3. 持久化
    await invoke("set_config", { newConfig });

    // 4. 即时切换划词悬浮窗监听（无需重启）
    let autoPopupError = "";
    if ((config.auto_popup_mode ?? "off") !== autoPopupMode) {
      try {
        await invoke("set_auto_popup_mode", { mode: autoPopupMode });
      } catch (error) {
        autoPopupError = String(error);
      }
    }

    // 5. 同步自启动
    const launchAtLogin = newConfig.launch_at_login;
    if (launchAtLogin) {
      if (!(await isEnabled())) await enable();
    } else if (await isEnabled()) {
      await disable();
    }

    // 6. 立即配置 sidecar（如已配置 AI）
    let sidecarOk = true;
    let sidecarError = "";
    if (newConfig.ai_provider && newConfig.ai_model) {
      try {
        await invoke("agent_configure", {
          provider: newConfig.ai_provider,
          model: newConfig.ai_model,
          apiKey: newConfig.ai_api_key || null,
          baseUrl: newConfig.ai_base_url || null,
        });
      } catch (error) {
        sidecarOk = false;
        sidecarError = error instanceof Error ? error.message : String(error);
      }
    }

    if (autoPopupError) {
      statusEl.textContent = `已保存，但悬浮窗监听未生效：${autoPopupError}`;
      statusEl.classList.add("error");
    } else if (sidecarOk) {
      statusEl.textContent = "已保存";
      statusEl.classList.add("success");
    } else {
      statusEl.textContent = `已保存，但助手配置未生效：${sidecarError || "助手未连接，请重启应用后再试"}`;
      statusEl.classList.add("error");
    }

    // 更新 config 引用以反映当前状态
    Object.assign(config, newConfig);
  };
}

function modelPlaceholder(provider: string): string {
  switch (provider) {
    case "anthropic": return "claude-sonnet-4-20250514";
    case "openai": return "gpt-4o";
    case "google": return "gemini-2.0-flash";
    default: return "选择服务商后填写";
  }
}

function supportsBaseUrl(provider: string): boolean {
  return provider === "openai" || provider === "anthropic" || provider === "google";
}

function baseUrlPlaceholder(provider: string): string {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com";
    case "google":
      return "https://generativelanguage.googleapis.com";
    default:
      return "https://api.example.com/v1";
  }
}

function validateAiConfig(config: Config): string | null {
  if (
    config.ai_provider === "openai" &&
    /\/apps\/anthropic\/?$/.test(config.ai_base_url.trim())
  ) {
    return "OpenAI 兼容地址不能使用 /apps/anthropic；百炼请填写 /compatible-mode/v1 地址。";
  }
  return null;
}

void render();
