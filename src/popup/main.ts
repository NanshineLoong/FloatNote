import "./styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalPosition, currentMonitor } from "@tauri-apps/api/window";
import { clampToScreen, type Rect } from "./clamp";

const POPUP_W = 208;
const POPUP_H = 56;

interface PopupPayload {
  x: number;
  y: number;
  hasText: boolean;
}

const root = document.querySelector<HTMLElement>("#popup")!;
const emptyEl = document.querySelector<HTMLElement>("#popup-empty")!;
const actionsEl = document.querySelector<HTMLElement>("#popup-actions")!;
const captureBtn = document.querySelector<HTMLButtonElement>("#btn-capture")!;

let hideTimer: number | null = null;

function clearHideTimer(): void {
  if (hideTimer !== null) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

async function dismiss(): Promise<void> {
  clearHideTimer();
  try {
    await invoke("dismiss_popup");
  } catch {
    // ignore — window may already be hidden
  }
}

function renderState(hasText: boolean): void {
  if (hasText) {
    emptyEl.hidden = true;
    actionsEl.hidden = false;
    captureBtn.disabled = false;
  } else {
    actionsEl.hidden = true;
    emptyEl.hidden = false;
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      void dismiss();
    }, 3000);
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

async function showAt(x: number, y: number, hasText: boolean): Promise<void> {
  const bounds = await getBoundsAt(x, y);
  const { x: cx, y: cy } = clampToScreen(x, y, POPUP_W, POPUP_H, bounds);
  const win = getCurrentWindow();
  await win.setPosition(new LogicalPosition(cx, cy));
  renderState(hasText);
  root.hidden = false;
  await win.show();
  await win.setFocus();
}

async function onSubmit(): Promise<void> {
  try {
    await invoke("submit_popup_capture");
  } catch (error) {
    console.error("submit_popup_capture failed", error);
  }
}

async function setupListeners(): Promise<void> {
  await listen<PopupPayload>("popup-payload", (event) => {
    void showAt(event.payload.x, event.payload.y, event.payload.hasText);
  });

  await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    // Dismiss when the popup loses focus (user clicked elsewhere).
    if (!focused) {
      void dismiss();
    }
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
