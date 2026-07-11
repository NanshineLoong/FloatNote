import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { open } from "@tauri-apps/plugin-dialog";
import { KeyRecorder } from "./key-recorder";
import { getProviderProfile, normalizeProvider, PROVIDER_PROFILES } from "./provider-profiles";
import { applyAppearance, initializeAppearance, type ThemePreference } from "../shared/appearance";
import { escapeHtml } from "../shared/escape";
import { createIcon } from "../shared/ui/icon";
import {
  findAllConflicts,
  WINDOW_SHORTCUT_DEFAULTS,
  WINDOW_SHORTCUT_IDS,
  WINDOW_SHORTCUT_LABELS,
  type WindowShortcutId,
} from "../shared/shortcuts";

interface Config {
  shortcut_capture: string; shortcut_toggle: string; shortcut_popup: string; auto_popup_mode: string;
  font_size: number; theme: ThemePreference; launch_at_login: boolean;
  ai_provider: string; ai_model: string; ai_api_key: string; ai_base_url: string;
  disabled_skills: string[];
  window_shortcuts: Record<WindowShortcutId, string>;
}
interface Skill { name: string; description: string; }
const app = document.querySelector<HTMLElement>("#app")!;
const clampFont = (size: number) => Math.min(28, Math.max(10, size));

async function render() {
  const config = await invoke<Config>("get_config");
  config.theme ??= "system";
  config.disabled_skills ??= [];
  config.ai_provider = normalizeProvider(config.ai_provider === "custom" ? "custom" : config.ai_provider);
  if (!config.ai_model) config.ai_model = getProviderProfile(config.ai_provider).models[0] ?? "";
  applyAppearance(config.theme, config.font_size);

  app.innerHTML = `<main class="settings-shell">
    <nav class="settings-nav" aria-label="设置分类">
      <button class="settings-tab is-active" data-tab="general">${createIcon({ phosphor: "ph ph-sliders-horizontal" }).outerHTML}<span>通用</span></button>
      <button class="settings-tab" data-tab="ai">${createIcon({ phosphor: "ph ph-sparkle" }).outerHTML}<span>AI 导师</span></button>
      <button class="settings-tab" data-tab="shortcuts">${createIcon({ phosphor: "ph ph-keyboard" }).outerHTML}<span>快捷键</span></button>
    </nav>
    <section class="settings-content">
      <div class="settings-pane" data-pane="general">
        <div class="settings-group"><h2>外观</h2>
          <div class="settings-line"><div><strong>主题</strong></div><select id="theme" class="fn-control"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></div>
          <div class="settings-line"><div><strong>界面字号</strong><small>⌘ + / ⌘ − · Windows: Ctrl + / Ctrl −</small></div><div class="stepper"><button id="font-down" aria-label="减小字号">−</button><output id="font-value">${config.font_size}px</output><button id="font-up" aria-label="增大字号">+</button></div></div>
          <div class="settings-line"><div><strong>开机启动</strong></div><label class="settings-toggle"><input id="autostart" type="checkbox" ${config.launch_at_login ? "checked" : ""}/><span class="settings-toggle-track"></span></label></div>
        </div>
      </div>
      <div class="settings-pane" data-pane="ai" hidden>
        <div class="settings-group"><h2>模型</h2>
          <div class="settings-field"><label for="provider">服务商</label><select id="provider" class="fn-control">${PROVIDER_PROFILES.map(p => `<option value="${p.id}" ${p.id === config.ai_provider ? "selected" : ""}>${p.label}</option>`).join("")}</select></div>
          <div class="settings-field"><label for="model">模型</label><select id="model" class="fn-control"></select><input id="custom-model" class="fn-control" placeholder="自定义模型名称" hidden /></div>
          <div class="settings-field"><label for="api-key">API Key</label><input id="api-key" class="fn-control" type="password" placeholder="请输入 API Key" value="${escapeHtml(config.ai_api_key)}" /></div>
          <div class="settings-field" id="base-url-field"><label for="base-url">兼容地址</label><input id="base-url" class="fn-control" type="url" value="${escapeHtml(config.ai_base_url)}" /></div>
        </div>
        <div class="settings-group"><div class="settings-heading"><h2>Skills</h2><button id="import-skill" class="settings-text-button">导入 Skill</button></div><div id="skills" class="skills-list"><span class="settings-muted">正在读取…</span></div></div>
      </div>
      <div class="settings-pane" data-pane="shortcuts" hidden>
        <div class="settings-group"><h2>全局快捷键</h2>${shortcutMarkup("capture", "划线引用", config.shortcut_capture)}${shortcutMarkup("toggle", "显示 / 隐藏", config.shortcut_toggle)}${shortcutMarkup("popup", "划词弹窗", config.shortcut_popup)}
          <div class="settings-line"><div><strong>划词悬浮窗</strong></div><select id="auto-popup-mode" class="fn-control"><option value="auto">自动弹出（macOS）</option><option value="shortcut">仅快捷键</option><option value="off">关闭</option></select></div></div>
        <div class="settings-group"><h2>窗口快捷键</h2>${WINDOW_SHORTCUT_IDS.map(id => shortcutMarkup(id, WINDOW_SHORTCUT_LABELS[id], config.window_shortcuts?.[id] ?? WINDOW_SHORTCUT_DEFAULTS[id])).join("")}</div>
      </div>
      <p id="settings-error" class="settings-error" role="alert"></p>
    </section>
  </main>`;

  const error = (message = "") => { app.querySelector<HTMLElement>("#settings-error")!.textContent = message; };
  const save = async () => { await invoke("set_config", { newConfig: config }); };
  const saveOrError = async (action: () => Promise<void>) => { try { error(); await action(); } catch (e) { error(String(e)); } };
  const select = <T extends HTMLElement>(id: string) => app.querySelector<T>(`#${id}`)!;
  const theme = select<HTMLSelectElement>("theme"); theme.value = config.theme;
  theme.onchange = () => void saveOrError(async () => { config.theme = theme.value as ThemePreference; applyAppearance(config.theme, config.font_size); await save(); });
  const changeFont = (delta: number) => void saveOrError(async () => { config.font_size = clampFont(config.font_size + delta); select<HTMLOutputElement>("font-value").value = `${config.font_size}px`; applyAppearance(config.theme, config.font_size); await save(); });
  select<HTMLButtonElement>("font-down").onclick = () => changeFont(-1); select<HTMLButtonElement>("font-up").onclick = () => changeFont(1);
  select<HTMLInputElement>("autostart").onchange = () => void saveOrError(async () => { const checked = select<HTMLInputElement>("autostart").checked; if (checked ? !(await isEnabled()) : await isEnabled()) checked ? await enable() : await disable(); config.launch_at_login = checked; await save(); });
  app.querySelectorAll<HTMLButtonElement>(".settings-tab").forEach(tab => tab.onclick = () => { app.querySelectorAll(".settings-tab").forEach(x => x.classList.toggle("is-active", x === tab)); app.querySelectorAll<HTMLElement>(".settings-pane").forEach(p => p.hidden = p.dataset.pane !== tab.dataset.tab); });

  const provider = select<HTMLSelectElement>("provider"); const model = select<HTMLSelectElement>("model"); const customModel = select<HTMLInputElement>("custom-model"); const baseUrlField = select<HTMLElement>("base-url-field");
  const renderProfile = () => { const profile = getProviderProfile(provider.value); model.innerHTML = `${profile.models.map(value => `<option value="${value}">${value}</option>`).join("")}<option value="__custom__">自定义…</option>`; model.value = profile.models.includes(config.ai_model) ? config.ai_model : "__custom__"; customModel.hidden = model.value !== "__custom__"; customModel.value = model.value === "__custom__" ? config.ai_model : ""; baseUrlField.hidden = !profile.baseUrl && provider.value !== "custom"; select<HTMLInputElement>("base-url").value = config.ai_base_url || profile.baseUrl || ""; };
  const configureAi = async () => { const profile = getProviderProfile(config.ai_provider); await invoke("agent_configure", { provider: profile.piProvider, model: config.ai_model, apiKey: config.ai_api_key || null, baseUrl: config.ai_base_url || profile.baseUrl || null }); };
  const saveAi = () => void saveOrError(async () => { await save(); await configureAi(); });
  renderProfile();
  provider.onchange = () => { config.ai_provider = provider.value; const profile = getProviderProfile(provider.value); config.ai_model = profile.models[0] ?? ""; config.ai_base_url = profile.baseUrl ?? ""; renderProfile(); saveAi(); };
  model.onchange = () => { customModel.hidden = model.value !== "__custom__"; config.ai_model = model.value === "__custom__" ? customModel.value.trim() : model.value; saveAi(); };
  customModel.onchange = () => { config.ai_model = customModel.value.trim(); saveAi(); };
  select<HTMLInputElement>("api-key").onchange = () => { config.ai_api_key = select<HTMLInputElement>("api-key").value.trim(); saveAi(); };
  select<HTMLInputElement>("base-url").onchange = () => { config.ai_base_url = select<HTMLInputElement>("base-url").value.trim(); saveAi(); };
  void loadSkills(config, save, error);
  select<HTMLButtonElement>("import-skill").onclick = () => void saveOrError(async () => {
    const chosen = await open({ title: "导入 Skill", directory: false, multiple: false, filters: [{ name: "Skill", extensions: ["md"] }] });
    if (!chosen || Array.isArray(chosen)) return;
    await invoke("agent_import_skill", { sourcePath: chosen });
    await loadSkills(config, save, error);
  });

  const recorders: Record<string, KeyRecorder> = {};
  const globals = ["capture", "toggle", "popup"] as const;
  const readShortcuts = () => ({ capture: recorders.capture.value, toggle: recorders.toggle.value, popup: recorders.popup.value });
  const applyShortcuts = () => void saveOrError(async () => { const windows = Object.fromEntries(WINDOW_SHORTCUT_IDS.map(id => [id, recorders[id].value])) as Record<WindowShortcutId, string>; const conflicts = findAllConflicts(windows, readShortcuts()); app.querySelectorAll<HTMLElement>(".shortcut-error").forEach(el => { const key = el.dataset.shortcut!; const conflict = WINDOW_SHORTCUT_IDS.includes(key as WindowShortcutId) ? conflicts[key as WindowShortcutId] : undefined; el.textContent = conflict?.message ?? ""; }); if (Object.keys(conflicts).length) return; await invoke("apply_shortcuts", { capture: recorders.capture.value, toggle: recorders.toggle.value, popup: recorders.popup.value, windowShortcuts: windows }); config.shortcut_capture = recorders.capture.value; config.shortcut_toggle = recorders.toggle.value; config.shortcut_popup = recorders.popup.value; config.window_shortcuts = windows; await save(); });
  [...globals, ...WINDOW_SHORTCUT_IDS].forEach(id => { recorders[id] = new KeyRecorder(select<HTMLElement>(`recorder-${id}`), id in config.window_shortcuts ? config.window_shortcuts[id as WindowShortcutId] : config[`shortcut_${id}` as keyof Config] as string, applyShortcuts); });
  const autoPopup = select<HTMLSelectElement>("auto-popup-mode"); autoPopup.value = config.auto_popup_mode; autoPopup.onchange = () => void saveOrError(async () => { await invoke("set_auto_popup_mode", { mode: autoPopup.value }); config.auto_popup_mode = autoPopup.value; await save(); });
}

function shortcutMarkup(id: string, label: string, value: string): string { return `<div class="shortcut-line"><div><strong>${label}</strong><span class="shortcut-error" data-shortcut="${id}"></span></div><div id="recorder-${id}" class="key-recorder" tabindex="0"><span class="key-recorder-label">${escapeHtml(value)}</span></div></div>`; }
async function loadSkills(config: Config, save: () => Promise<void>, error: (message: string) => void) { const box = document.querySelector<HTMLElement>("#skills")!; try { const skills = await invoke<Skill[]>("agent_list_skills"); box.innerHTML = skills.length ? skills.map(skill => `<label class="skill-line"><span><strong>${escapeHtml(skill.name)}</strong><small>${escapeHtml(skill.description)}</small></span><span class="settings-toggle"><input type="checkbox" data-skill="${escapeHtml(skill.name)}" ${config.disabled_skills.includes(skill.name) ? "" : "checked"}/><span class="settings-toggle-track"></span></span></label>`).join("") : `<span class="settings-muted">暂无可用 Skill</span>`; box.querySelectorAll<HTMLInputElement>("[data-skill]").forEach(input => input.onchange = () => { const name = input.dataset.skill!; config.disabled_skills = input.checked ? config.disabled_skills.filter(x => x !== name) : [...config.disabled_skills, name]; void save().then(() => invoke("agent_reload_skills")).then(() => loadSkills(config, save, error)).catch(e => error(String(e))); }); } catch (e) { box.textContent = "无法读取 Skills"; error(String(e)); } }

void initializeAppearance();
void render();
