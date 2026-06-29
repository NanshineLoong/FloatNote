import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { KeyRecorder } from "./key-recorder";

interface Config {
  working_dir: string | null;
  shortcut_capture: string;
  shortcut_toggle: string;
  font_size: number;
  launch_at_login: boolean;
  ai_provider: string;
  ai_model: string;
  ai_api_key: string;
  ai_base_url: string;
}

const app = document.querySelector<HTMLElement>("#app")!;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => {
    const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[ch];
  });
}

function displayDir(path: string | null): string {
  if (!path) return "";
  // 只显示最后一级目录名
  const parts = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

async function render() {
  const config = await invoke<Config>("get_config");

  app.innerHTML = `
    <div class="settings-page">

      <!-- ── 通用 ── -->
      <section class="settings-section">
        <div class="settings-section-header">
          <i class="ph ph-gear"></i>
          <span>通用</span>
        </div>

        <div class="settings-row">
          <label class="settings-label">工作目录</label>
          <div class="settings-control-row">
            <input id="working-dir" type="text" readonly
              placeholder="未设置"
              value="${escapeHtml(displayDir(config.working_dir))}"
              title="${escapeHtml(config.working_dir ?? "")}" />
            <button id="pick-dir" class="settings-btn-secondary" type="button" title="选择文件夹">
              <i class="ph ph-folder-open"></i>
            </button>
          </div>
        </div>

        <div class="settings-row">
          <label class="settings-label">字体大小</label>
          <div class="settings-control-row">
            <input id="font-size" type="range" min="10" max="28" step="1"
              value="${config.font_size}" />
            <span id="font-size-value" class="settings-value">${config.font_size}</span>
          </div>
        </div>

        <div class="settings-row settings-row-inline">
          <label class="settings-label">开机自启动</label>
          <label class="settings-toggle">
            <input id="autostart" type="checkbox" ${config.launch_at_login ? "checked" : ""} />
            <span class="settings-toggle-track"></span>
          </label>
        </div>
      </section>

      <!-- ── 快捷键 ── -->
      <section class="settings-section">
        <div class="settings-section-header">
          <i class="ph ph-keyboard"></i>
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
      </section>

      <!-- ── AI 助手 ── -->
      <section class="settings-section">
        <div class="settings-section-header">
          <i class="ph ph-brain"></i>
          <span>AI 助手</span>
        </div>

        <div class="settings-row">
          <label class="settings-label">服务商</label>
          <select id="ai-provider" class="settings-select">
            <option value="">未配置</option>
            <option value="anthropic" ${config.ai_provider === "anthropic" ? "selected" : ""}>Anthropic</option>
            <option value="openai" ${config.ai_provider === "openai" ? "selected" : ""}>OpenAI</option>
            <option value="google" ${config.ai_provider === "google" ? "selected" : ""}>Google</option>
            <option value="custom" ${config.ai_provider === "custom" ? "selected" : ""}>自定义</option>
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

        <div class="settings-row" id="base-url-row" ${!supportsBaseUrl(config.ai_provider) ? "hidden" : ""}>
          <label class="settings-label">自定义地址</label>
          <input id="ai-base-url" type="text"
            placeholder="${baseUrlPlaceholder(config.ai_provider)}"
            value="${escapeHtml(config.ai_base_url)}" />
        </div>
      </section>

      <!-- ── Footer ── -->
      <div class="settings-footer">
        <span id="settings-status" class="settings-status"></span>
        <button id="save-btn" class="settings-btn-primary" type="button">保存</button>
      </div>
    </div>
  `;

  // ── 初始化快捷键录制器 ──
  const captureRecorder = new KeyRecorder(
    document.querySelector("#recorder-capture")!,
    config.shortcut_capture,
  );
  const toggleRecorder = new KeyRecorder(
    document.querySelector("#recorder-toggle")!,
    config.shortcut_toggle,
  );

  // ── 工作目录选择 ──
  let currentDir = config.working_dir;
  document.querySelector<HTMLButtonElement>("#pick-dir")!.onclick = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      currentDir = selected as string;
      const input = document.querySelector<HTMLInputElement>("#working-dir")!;
      input.value = displayDir(currentDir);
      input.title = currentDir;
    }
  };

  // ── 字号滑块 ──
  const fontSlider = document.querySelector<HTMLInputElement>("#font-size")!;
  const fontValue = document.querySelector<HTMLElement>("#font-size-value")!;
  fontSlider.oninput = () => {
    fontValue.textContent = fontSlider.value;
  };

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

  // ── 保存 ──
  document.querySelector<HTMLButtonElement>("#save-btn")!.onclick = async () => {
    const statusEl = document.querySelector<HTMLElement>("#settings-status")!;
    statusEl.textContent = "";
    statusEl.className = "settings-status";

    const capture = captureRecorder.value;
    const toggle = toggleRecorder.value;

    // 1. 验证快捷键
    try {
      await invoke("apply_shortcuts", { capture, toggle });
    } catch (error) {
      statusEl.textContent = `快捷键无效或被占用：${error}`;
      statusEl.classList.add("error");
      return;
    }

    // 2. 构建完整配置
    const newConfig: Config = {
      ...config,
      working_dir: currentDir,
      shortcut_capture: capture,
      shortcut_toggle: toggle,
      font_size: parseInt(fontSlider.value, 10),
      launch_at_login: document.querySelector<HTMLInputElement>("#autostart")!.checked,
      ai_provider: providerSelect.value,
      ai_model: modelInput.value.trim(),
      ai_api_key: document.querySelector<HTMLInputElement>("#ai-api-key")!.value.trim(),
      ai_base_url: document.querySelector<HTMLInputElement>("#ai-base-url")!.value.trim(),
    };

    const aiConfigError = validateAiConfig(newConfig);
    if (aiConfigError) {
      statusEl.textContent = aiConfigError;
      statusEl.classList.add("error");
      return;
    }

    // 3. 持久化
    await invoke("set_config", { newConfig });

    // 4. 同步工作目录
    if (currentDir && currentDir !== config.working_dir) {
      await invoke("set_working_dir", { dir: currentDir });
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

    if (sidecarOk) {
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
    case "custom": return "模型名称";
    default: return "选择服务商后填写";
  }
}

function supportsBaseUrl(provider: string): boolean {
  return provider === "openai" || provider === "custom";
}

function baseUrlPlaceholder(provider: string): string {
  if (provider === "openai") {
    return "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1";
  }
  return "https://api.example.com/v1";
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
