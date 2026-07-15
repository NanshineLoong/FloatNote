import "@phosphor-icons/web/regular";
import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition, LogicalSize, currentMonitor } from "@tauri-apps/api/window";
import { placePopup, type Rect } from "./clamp";
import { showToast } from "../shared/toast";
import { createButton } from "../shared/ui/button";
import { initializeAppearance } from "../shared/appearance";
import { createPopupState, reducePopupState, type PopupState } from "./state";
import { createLatestTaskQueue } from "./latest-task";
import {
  popupSelectionSnapshot,
  translatePopupSelection,
  type PopupQuestionResult,
} from "../platform/selection-popup";

void initializeAppearance();

const SHADOW_INSET = 6;
const SHORTCUT_ERROR_MS = 1600;

interface PopupPayload {
  x: number;
  y: number;
  generationId: number;
  origin: "auto" | "shortcut";
  hasText: boolean;
}

const root = document.querySelector<HTMLElement>("#popup")!;
const emptyEl = document.querySelector<HTMLElement>("#popup-empty")!;
const actionsEl = document.querySelector<HTMLElement>("#popup-actions")!;
const panelEl = document.createElement("section");
panelEl.className = "popup-panel";
panelEl.hidden = true;
root.appendChild(panelEl);

const captureBtn = actionButton("primary", "ph-quotes", "采集");
const translateBtn = actionButton("secondary", "ph-translate", "翻译");
const questionBtn = actionButton("secondary", "ph-chat-circle-dots", "提问");
captureBtn.id = "btn-capture";
actionsEl.append(captureBtn, translateBtn, questionBtn);

let hideTimer: number | null = null;
let activePayload: PopupPayload | null = null;
let state: PopupState | null = null;
let selectionSummary = "";
const layoutQueue = createLatestTaskQueue();

function actionButton(variant: "primary" | "secondary", icon: string, label: string): HTMLButtonElement {
  const button = createButton({ variant, icon, label, title: label });
  button.setAttribute("aria-label", label);
  return button;
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `popup-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clearHideTimer(): void {
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = null;
}

async function dismiss(): Promise<void> {
  clearHideTimer();
  root.classList.remove("is-visible");
  try { await invoke("dismiss_popup", { generationId: state?.generationId ?? null }); } catch { /* already hidden */ }
}

async function getBoundsAt(x: number, y: number): Promise<Rect> {
  const win = getCurrentWindow();
  await win.setPosition(new LogicalPosition(x, y));
  const monitor = await currentMonitor();
  if (!monitor) return { minX: x - 2000, minY: y - 2000, maxX: x + 2000, maxY: y + 2000 };
  const sf = monitor.scaleFactor || 1;
  const mx = monitor.position.x / sf;
  const my = monitor.position.y / sf;
  return { minX: mx, minY: my, maxX: mx + monitor.size.width / sf, maxY: my + monitor.size.height / sf };
}

async function resizeAndPlace(content: HTMLElement, taskIsCurrent: () => boolean): Promise<void> {
  if (!activePayload) return;
  const payload = activePayload;
  const generationId = state?.generationId;
  const isCurrent = () => taskIsCurrent() && activePayload === payload && state?.generationId === generationId;
  const win = getCurrentWindow();
  root.classList.add("is-measuring");
  root.hidden = false;
  const rect = content.getBoundingClientRect();
  const width = Math.ceil(rect.width + SHADOW_INSET * 2);
  const height = Math.ceil(rect.height + SHADOW_INSET * 2);
  if (!isCurrent()) return;
  await win.setSize(new LogicalSize(width, height));
  if (!isCurrent()) return;
  const bounds = await getBoundsAt(payload.x, payload.y);
  if (!isCurrent()) return;
  const placed = placePopup(payload.x, payload.y, width, height, bounds);
  await win.setPosition(new LogicalPosition(placed.x, placed.y));
  if (!isCurrent()) return;
  root.classList.remove("is-measuring");
  await win.show();
  requestAnimationFrame(() => root.classList.add("is-visible"));
}

function scheduleResizeAndPlace(content: HTMLElement): void {
  void layoutQueue.schedule((isCurrent) => resizeAndPlace(content, isCurrent));
}

function summaryMarkup(): string {
  return `<div class="popup-summary" title="${escapeHtml(selectionSummary)}">${escapeHtml(selectionSummary || "选中文字")}</div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function panelButton(label: string, className = ""): string {
  return `<button type="button" class="popup-text-action ${className}">${label}</button>`;
}

function render(): void {
  if (!state) return;
  actionsEl.hidden = state.view.kind !== "actions";
  emptyEl.hidden = true;
  panelEl.hidden = state.view.kind === "actions" || state.view.kind === "dismiss";
  if (state.view.kind === "actions") {
    scheduleResizeAndPlace(actionsEl);
    return;
  }
  if (state.view.kind === "dismiss") {
    void dismiss();
    return;
  }
  const view = state.view;
  if (view.kind === "translate-loading") {
    panelEl.innerHTML = `${summaryMarkup()}<div class="popup-status" role="status"><i class="ph ph-spinner-gap"></i>正在翻译…</div>`;
  } else if (view.kind === "translate-result") {
    panelEl.innerHTML = `${summaryMarkup()}<div class="popup-result" tabindex="0">${escapeHtml(view.text)}</div><div class="popup-footer">${panelButton("复制", "copy")}${panelButton("关闭", "close")}</div>`;
  } else if (view.kind === "translate-error") {
    const settings = view.message.includes("AI 提供商") ? panelButton("打开设置", "open-settings") : "";
    panelEl.innerHTML = `${summaryMarkup()}<div class="popup-error" role="alert">${escapeHtml(view.message)}</div><div class="popup-footer">${settings}${panelButton("重试", "retry-translate")}${panelButton("返回", "back")}</div>`;
  } else if (view.kind === "question-sent-warning") {
    panelEl.innerHTML = `${summaryMarkup()}<div class="popup-error" role="status">${escapeHtml(view.message)}</div><div class="popup-footer">${panelButton("关闭", "close")}</div>`;
  } else {
    const draft = "draft" in view ? view.draft : "";
    const sending = view.kind === "question-sending";
    const error = view.kind === "question-error" ? `<div class="popup-error" role="alert">${escapeHtml(view.message)}</div>` : "";
    const settings = view.kind === "question-error" && view.message.includes("AI 提供商") ? panelButton("打开设置", "open-settings") : "";
    panelEl.innerHTML = `${summaryMarkup()}<textarea class="popup-question" aria-label="针对选中文字提问" placeholder="针对选中文字提问…" ${sending ? "disabled" : ""}>${escapeHtml(draft)}</textarea>${error}<div class="popup-footer">${settings}${panelButton("返回", "back")}${panelButton(sending ? "发送中…" : "发送", "send-question")}</div>`;
    panelEl.querySelector<HTMLButtonElement>(".send-question")!.disabled = sending || !draft.trim();
    if (!sending) requestAnimationFrame(() => panelEl.querySelector<HTMLTextAreaElement>(".popup-question")?.focus());
  }
  wirePanelActions();
  scheduleResizeAndPlace(panelEl);
}

function wirePanelActions(): void {
  panelEl.querySelector<HTMLButtonElement>(".back")?.addEventListener("click", () => {
    if (!state) return;
    state = reducePopupState(state, { type: "back" });
    render();
  });
  panelEl.querySelector<HTMLButtonElement>(".close")?.addEventListener("click", () => void dismiss());
  panelEl.querySelector<HTMLButtonElement>(".open-settings")?.addEventListener("click", () => void invoke("open_ai_settings"));
  panelEl.querySelector<HTMLButtonElement>(".copy")?.addEventListener("click", async () => {
    const text = state?.view.kind === "translate-result" ? state.view.text : "";
    try {
      await navigator.clipboard.writeText(text);
      showToast("已复制译文");
    } catch {
      showToast("复制失败，请手动选择译文复制");
    }
  });
  panelEl.querySelector<HTMLButtonElement>(".retry-translate")?.addEventListener("click", () => void startTranslation());
  const textarea = panelEl.querySelector<HTMLTextAreaElement>(".popup-question");
  textarea?.addEventListener("input", () => {
    if (!state) return;
    state = reducePopupState(state, { type: "question-draft", draft: textarea.value });
    const send = panelEl.querySelector<HTMLButtonElement>(".send-question");
    if (send) send.disabled = !textarea.value.trim();
  });
  textarea?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendQuestion();
    }
  });
  panelEl.querySelector<HTMLButtonElement>(".send-question")?.addEventListener("click", () => void sendQuestion());
}

async function loadSummary(generationId: number): Promise<boolean> {
  try {
    const capture = await popupSelectionSnapshot(generationId);
    if (state?.generationId !== generationId) return false;
    selectionSummary = capture.text.replace(/\s+/g, " ").trim().slice(0, 160);
    return true;
  } catch (error) {
    showToast(errorMessage(error));
    return false;
  }
}

async function startTranslation(): Promise<void> {
  if (!state) return;
  if (state.view.kind === "translate-error") state = reducePopupState(state, { type: "back" });
  if (state.view.kind !== "actions") return;
  const generationId = state.generationId;
  const popupRequestId = requestId();
  state = reducePopupState(state, { type: "translate-start", popupRequestId });
  render();
  if (!(await loadSummary(generationId))) {
    if (state) state = reducePopupState(state, { type: "translate-error", generationId, popupRequestId, message: "选区已失效，请重新选择" });
    render();
    return;
  }
  if (state.generationId !== generationId || state.view.kind !== "translate-loading" || state.view.popupRequestId !== popupRequestId) return;
  render();
  try {
    const text = await translatePopupSelection(generationId, popupRequestId);
    if (!state) return;
    state = reducePopupState(state, { type: "translate-success", generationId, popupRequestId, text });
  } catch (error) {
    if (!state) return;
    state = reducePopupState(state, { type: "translate-error", generationId, popupRequestId, message: errorMessage(error) });
  }
  render();
}

async function editQuestion(): Promise<void> {
  if (!state || state.view.kind !== "actions") return;
  const generationId = state.generationId;
  state = reducePopupState(state, { type: "question-edit" });
  render();
  if (await loadSummary(generationId)) render();
}

async function sendQuestion(): Promise<void> {
  if (!state || state.view.kind !== "question-editing" || !state.view.draft.trim()) return;
  const popupRequestId = requestId();
  state = reducePopupState(state, { type: "question-send", popupRequestId });
  const { generationId } = state;
  const question = state.view.kind === "question-sending" ? state.view.draft.trim() : "";
  render();
  try {
    await emitTo("main", "popup-question-request", { generationId, popupRequestId, question });
  } catch (error) {
    if (!state) return;
    state = reducePopupState(state, { type: "question-error", generationId, popupRequestId, message: errorMessage(error) });
    render();
  }
}

async function showAt(payload: PopupPayload): Promise<void> {
  if (payload.origin === "auto" && !payload.hasText) return;
  activePayload = payload;
  selectionSummary = "";
  state = createPopupState(payload.generationId);
  root.classList.remove("is-visible");
  if (!payload.hasText) {
    actionsEl.hidden = true;
    panelEl.hidden = true;
    emptyEl.hidden = false;
    clearHideTimer();
    hideTimer = window.setTimeout(() => void dismiss(), SHORTCUT_ERROR_MS);
    scheduleResizeAndPlace(emptyEl);
    return;
  }
  clearHideTimer();
  render();
}

async function setupListeners(): Promise<void> {
  await listen<PopupPayload>("popup-payload", (event) => void showAt(event.payload));
  await listen<PopupQuestionResult>("popup-question-result", (event) => {
    if (!state || state.view.kind !== "question-sending") return;
    const result = event.payload;
    if (result.generationId !== state.generationId || result.popupRequestId !== state.view.popupRequestId) return;
    if (result.ok) {
      root.classList.remove("is-visible");
      return;
    }
    if (result.sent) {
      state = reducePopupState(state, { type: "question-sent-warning", generationId: result.generationId, popupRequestId: result.popupRequestId, message: result.message ?? "已发送，可在对话历史中查看" });
      render();
      return;
    }
    state = reducePopupState(state, { type: "question-error", generationId: result.generationId, popupRequestId: result.popupRequestId, message: result.message ?? "发送失败，请重试" });
    render();
  });
  await listen("accessibility-needed", () => showToast("需开启「辅助功能」权限后重试"));
  await listen("automation-needed", () => showToast("浏览器授权未完成，授权后重试即可"));
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state) return;
    event.preventDefault();
    state = reducePopupState(state, { type: "escape" });
    render();
  });
  captureBtn.addEventListener("click", () => state && void invoke("submit_popup_capture", { generationId: state.generationId }));
  translateBtn.addEventListener("click", () => void startTranslation());
  questionBtn.addEventListener("click", () => void editQuestion());
}

void setupListeners();
