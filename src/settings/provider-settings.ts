import { escapeHtml } from "../shared/escape";
import {
  getProviderProfile,
  isProviderConfigured,
  normalizeProviderDraft,
  PROVIDER_PROFILES,
  validateProviderDraft,
  type AiProviderConfig,
  type AiProviderId,
  type AiSettings,
  type ProviderDraftErrors,
} from "./provider-profiles";

export interface ProviderSettingsActions {
  saveProvider(providerId: AiProviderId, config: AiProviderConfig): Promise<void>;
  setActiveProvider(providerId: AiProviderId | null): Promise<void>;
}

export function mountProviderSettings(
  root: HTMLElement,
  settings: AiSettings,
  actions: ProviderSettingsActions,
): void {
  let expandedProviderId: AiProviderId | null = null;
  let busyProviderId: AiProviderId | null = null;
  const drafts = Object.fromEntries(
    PROVIDER_PROFILES.map(({ id }) => [id, { ...settings.providers[id] }]),
  ) as Record<AiProviderId, AiProviderConfig>;
  const errors: Partial<Record<AiProviderId, string>> = {};
  const fieldErrors: Partial<Record<AiProviderId, ProviderDraftErrors>> = {};

  const render = () => {
    root.innerHTML = `<div class="provider-list">${PROVIDER_PROFILES.map((profile) => {
      const saved = settings.providers[profile.id];
      const active = settings.activeProviderId === profile.id;
      const configured = isProviderConfigured(saved);
      const expanded = expandedProviderId === profile.id;
      const busy = busyProviderId === profile.id;
      const status = active ? "已启用" : configured ? "已配置" : "未配置";
      return `<article class="provider-item${active ? " is-active" : ""}" data-provider-id="${profile.id}">
        <div class="provider-row">
          <button class="provider-summary" type="button" data-provider-expand="${profile.id}" aria-expanded="${expanded}">
            <span class="provider-mark" aria-hidden="true">${escapeHtml(profile.mark)}</span>
            <span class="provider-copy"><strong>${escapeHtml(profile.label)}</strong><small id="provider-${profile.id}-status" class="provider-status">${status}</small></span>
            <span class="provider-chevron" aria-hidden="true">${expanded ? "−" : "+"}</span>
          </button>
          <label class="settings-toggle provider-toggle" title="${configured ? `${active ? "关闭" : "启用"}${escapeHtml(profile.label)}` : "请先保存 API Key 和模型"}">
            <input type="checkbox" data-provider-toggle="${profile.id}" aria-label="${configured ? `${active ? "关闭" : "启用"}${escapeHtml(profile.label)}` : `${escapeHtml(profile.label)}未配置，请先保存 API Key 和模型`}" aria-describedby="provider-${profile.id}-status" ${active ? "checked" : ""} ${configured && busyProviderId === null ? "" : "disabled"}/>
            <span class="settings-toggle-track"></span>
          </label>
        </div>
        ${expanded ? providerFormMarkup(profile.id, profile.allowsBaseUrl, busy, drafts[profile.id], settings.providers[profile.id], fieldErrors[profile.id]) : ""}
        <p class="provider-row-error" data-provider-error="${profile.id}" role="alert">${escapeHtml(errors[profile.id] ?? "")}</p>
      </article>`;
    }).join("")}</div>`;

    if (expandedProviderId) {
      const providerId = expandedProviderId;
      const draft = drafts[providerId];
      root.querySelector<HTMLInputElement>(`[data-provider-key="${providerId}"]`)!.value = draft.apiKey;
      root.querySelector<HTMLInputElement>(`[data-provider-model="${providerId}"]`)!.value = draft.model;
      const baseUrl = root.querySelector<HTMLInputElement>(`[data-provider-base-url="${providerId}"]`);
      if (baseUrl) baseUrl.value = draft.baseUrl ?? "";
      wireForm(providerId);
    }

    root.querySelectorAll<HTMLButtonElement>("[data-provider-expand]").forEach((button) => {
      button.onclick = () => {
        const providerId = button.dataset.providerExpand as AiProviderId;
        expandedProviderId = expandedProviderId === providerId ? null : providerId;
        render();
      };
    });
    root.querySelectorAll<HTMLInputElement>("[data-provider-toggle]").forEach((toggle) => {
      toggle.onchange = () => void changeActive(toggle.dataset.providerToggle as AiProviderId, toggle.checked);
    });
  };

  const wireForm = (providerId: AiProviderId) => {
    const key = root.querySelector<HTMLInputElement>(`[data-provider-key="${providerId}"]`)!;
    const model = root.querySelector<HTMLInputElement>(`[data-provider-model="${providerId}"]`)!;
    const baseUrl = root.querySelector<HTMLInputElement>(`[data-provider-base-url="${providerId}"]`);
    const save = root.querySelector<HTMLButtonElement>(`[data-provider-save="${providerId}"]`)!;
    const sync = () => {
      drafts[providerId] = { apiKey: key.value, model: model.value, ...(baseUrl?.value ? { baseUrl: baseUrl.value } : {}) };
      save.disabled = busyProviderId !== null || !isDirty(providerId) || Object.keys(validateProviderDraft(providerId, drafts[providerId])).length > 0;
    };
    const showValidation = () => {
      fieldErrors[providerId] = validateProviderDraft(providerId, drafts[providerId]);
      for (const field of ["apiKey", "model", "baseUrl"] as const) {
        const message = root.querySelector<HTMLElement>(`[data-provider-field-error="${providerId}-${field}"]`);
        if (message) message.textContent = fieldErrors[providerId]?.[field] ?? "";
      }
    };
    for (const input of [key, model, baseUrl].filter(Boolean) as HTMLInputElement[]) {
      input.oninput = sync;
      input.onblur = () => { sync(); showValidation(); };
    }
    save.onclick = () => void saveProvider(providerId);
    sync();
  };

  const isDirty = (providerId: AiProviderId) => {
    const draft = drafts[providerId];
    const saved = settings.providers[providerId];
    return draft.apiKey !== saved.apiKey || draft.model !== saved.model || (draft.baseUrl ?? "") !== (saved.baseUrl ?? "");
  };

  const saveProvider = async (providerId: AiProviderId) => {
    fieldErrors[providerId] = validateProviderDraft(providerId, drafts[providerId]);
    if (Object.keys(fieldErrors[providerId]!).length) {
      render();
      return;
    }
    const normalized = normalizeProviderDraft(providerId, drafts[providerId]);
    busyProviderId = providerId;
    errors[providerId] = "";
    render();
    try {
      await actions.saveProvider(providerId, normalized);
      settings.providers[providerId] = normalized;
      drafts[providerId] = { ...normalized };
    } catch (error) {
      errors[providerId] = String(error);
    } finally {
      busyProviderId = null;
      render();
    }
  };

  const changeActive = async (providerId: AiProviderId, checked: boolean) => {
    const next = checked ? providerId : null;
    busyProviderId = providerId;
    errors[providerId] = "";
    render();
    try {
      await actions.setActiveProvider(next);
      settings.activeProviderId = next;
    } catch (error) {
      errors[providerId] = String(error);
    } finally {
      busyProviderId = null;
      render();
    }
  };

  render();
}

function providerFormMarkup(
  providerId: AiProviderId,
  allowsBaseUrl: boolean,
  busy: boolean,
  draft: AiProviderConfig,
  saved: AiProviderConfig,
  errors: ProviderDraftErrors = {},
): string {
  const profile = getProviderProfile(providerId);
  const dirty = draft.apiKey !== saved.apiKey || draft.model !== saved.model || (draft.baseUrl ?? "") !== (saved.baseUrl ?? "");
  const invalid = Object.keys(validateProviderDraft(providerId, draft)).length > 0;
  return `<form class="provider-form" data-provider-form="${providerId}" onsubmit="return false">
    <div class="settings-field"><label for="provider-${providerId}-key">API Key</label><input id="provider-${providerId}-key" class="fn-control" type="password" autocomplete="off" data-provider-key="${providerId}" aria-invalid="${Boolean(errors.apiKey)}" aria-describedby="provider-${providerId}-key-error"/><small id="provider-${providerId}-key-error" class="provider-field-error" data-provider-field-error="${providerId}-apiKey">${escapeHtml(errors.apiKey ?? "")}</small></div>
    <div class="settings-field"><label for="provider-${providerId}-model">模型</label><input id="provider-${providerId}-model" class="fn-control" type="text" autocomplete="off" placeholder="输入模型 ID" data-provider-model="${providerId}" aria-invalid="${Boolean(errors.model)}" aria-describedby="provider-${providerId}-model-error"/><small id="provider-${providerId}-model-error" class="provider-field-error" data-provider-field-error="${providerId}-model">${escapeHtml(errors.model ?? "")}</small></div>
    ${allowsBaseUrl ? `<div class="settings-field"><label for="provider-${providerId}-base-url">Base URL <span>可选</span></label><input id="provider-${providerId}-base-url" class="fn-control" type="url" autocomplete="url" placeholder="留空使用官方地址" data-provider-base-url="${providerId}" aria-invalid="${Boolean(errors.baseUrl)}" aria-describedby="provider-${providerId}-base-url-error"/><small id="provider-${providerId}-base-url-error" class="provider-field-error" data-provider-field-error="${providerId}-baseUrl">${escapeHtml(errors.baseUrl ?? "")}</small></div>` : ""}
    <div class="provider-form-actions"><span class="provider-save-note" aria-live="polite">${busy ? `正在保存 ${escapeHtml(profile.label)}…` : ""}</span><button class="fn-button fn-button-primary" type="button" data-provider-save="${providerId}" ${busy || !dirty || invalid ? "disabled" : ""}>${busy ? "保存中…" : "保存"}</button></div>
  </form>`;
}
