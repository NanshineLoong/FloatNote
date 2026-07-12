import "@phosphor-icons/web/regular";
import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition, LogicalSize, currentMonitor } from "@tauri-apps/api/window";
import { placePopup, type Rect } from "./clamp";
import { showToast } from "../shared/toast";
import { createButton } from "../shared/ui/button";
import { initializeAppearance } from "../shared/appearance";

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
const captureBtn = createButton({
  variant: "primary",
  icon: "ph-quotes",
  label: "采集",
  title: "采集",
});
captureBtn.id = "btn-capture";
actionsEl.appendChild(captureBtn);

let hideTimer: number | null = null;
let activeGenerationId: number | null = null;

function clearHideTimer(): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

async function dismiss(): Promise<void> {
  clearHideTimer();
  root.classList.remove("is-visible");
  try {
    await invoke("dismiss_popup", { generationId: activeGenerationId });
  } catch {
    // ignore — window may already be hidden
  }
}

function renderState(payload: PopupPayload): HTMLElement | null {
  if (payload.origin === "auto" && !payload.hasText) return null;
  if (payload.hasText) {
    // A prior empty-state render may have armed a 3s auto-dismiss timer;
    // clear it so it doesn't fire and hide the popup while the user views actions.
    clearHideTimer();
    emptyEl.hidden = true;
    actionsEl.hidden = false;
    captureBtn.disabled = false;
    return actionsEl;
  } else {
    actionsEl.hidden = true;
    emptyEl.hidden = false;
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      void dismiss();
    }, SHORTCUT_ERROR_MS);
    return emptyEl;
  }
}

/**
 * Move the window to the cursor first so `currentMonitor()` reports the
 * monitor the cursor is on (handles multi-monitor layouts), then return that
 * monitor's logical bounds.
 */
async function getBoundsAt(x: number, y: number): Promise<Rect> {
  const win = getCurrentWindow();
  await win.setPosition(new LogicalPosition(x, y));
  const monitor = await currentMonitor();
  if (!monitor) {
    // Fallback: a generous rect around the cursor (no real clamping).
    return { minX: x - 2000, minY: y - 2000, maxX: x + 2000, maxY: y + 2000 };
  }
  const sf = monitor.scaleFactor || 1;
  const mx = monitor.position.x / sf;
  const my = monitor.position.y / sf;
  return {
    minX: mx,
    minY: my,
    maxX: mx + monitor.size.width / sf,
    maxY: my + monitor.size.height / sf,
  };
}

async function showAt(payload: PopupPayload): Promise<void> {
  const visibleContent = renderState(payload);
  if (!visibleContent) return;
  activeGenerationId = payload.generationId;

  const win = getCurrentWindow();
  root.classList.remove("is-visible");
  root.classList.add("is-measuring");
  root.hidden = false;
  const contentRect = visibleContent.getBoundingClientRect();
  const width = Math.ceil(contentRect.width + SHADOW_INSET * 2);
  const height = Math.ceil(contentRect.height + SHADOW_INSET * 2);
  await win.setSize(new LogicalSize(width, height));

  const bounds = await getBoundsAt(payload.x, payload.y);
  const { x, y } = placePopup(payload.x, payload.y, width, height, bounds);
  await win.setPosition(new LogicalPosition(x, y));
  root.classList.remove("is-measuring");
  await win.show();
  requestAnimationFrame(() => {
    root.classList.add("is-visible");
  });
}

async function onSubmit(): Promise<void> {
  if (activeGenerationId === null) return;
  try {
    await invoke("submit_popup_capture", { generationId: activeGenerationId });
  } catch (error) {
    console.error("submit_popup_capture failed", error);
  }
}

async function setupListeners(): Promise<void> {
  let lastAutomationToastAt = 0;

  await listen<PopupPayload>("popup-payload", (event) => {
    const payload = event.payload;
    if (payload.origin === "auto" && !payload.hasText) return;
    void showAt(payload);
  });

  // 与笔记窗共用同一套 toast：后端目前把 accessibility-needed 发往 main，
  // 这里先注册好，等后端按触发上下文分发时即可就地提示。
  await listen("accessibility-needed", () => {
    showToast("需开启「辅助功能」权限后重试");
  });

  // 浏览器自动化权限缺失时，后端同样发 automation-needed；弹窗内就地提示。
  await listen("automation-needed", () => {
    const now = Date.now();
    if (now - lastAutomationToastAt < 30_000) return;
    lastAutomationToastAt = now;
    showToast("浏览器授权未完成，授权后重试即可");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      void dismiss();
    }
  });

  captureBtn.addEventListener("click", () => {
    void onSubmit();
  });
}

void setupListeners();
