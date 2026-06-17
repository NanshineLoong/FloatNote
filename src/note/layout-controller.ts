import { invoke } from "@tauri-apps/api/core";
import { computeLayout, DEFAULT_PREFS, type Layout } from "./layout";

/**
 * 把 `computeLayout` 的结果落地到 DOM：写 CSS 变量、切 `assistant-embedded` 类、
 * 并在 placement 跨入/离开 detached 时通知 Rust 显隐独立助手窗。
 *
 * 监听窗口尺寸由调用方接线（resize 事件 → `apply`）。粘性偏好/开关也由调用方驱动。
 */
export interface StickyController {
  /** 按当前窗口宽度重算并落地。 */
  apply: () => void;
  /** 开/关整个助手。 */
  setOpen: (open: boolean) => void;
  /** 重叠区里翻转嵌入/分离偏好；返回新偏好。调用方应先确认 `canToggle()`。 */
  toggleSticky: () => "embedded" | "detached";
  /** 当前是否处于可手动切换的重叠区。 */
  canToggle: () => boolean;
}

export function createLayoutController(
  app: HTMLElement,
  init: { open: boolean; sticky: "embedded" | "detached" },
): StickyController {
  let open = init.open;
  let sticky = init.sticky;
  let detachedShown = false;
  let last: Layout | null = null;

  function apply() {
    const layout = computeLayout(window.innerWidth, { ...DEFAULT_PREFS, open, sticky });
    last = layout;

    app.style.setProperty("--left", `${layout.leftMargin}px`);
    app.style.setProperty("--text", `${layout.textWidth}px`);
    app.style.setProperty("--right", `${layout.rightMargin}px`);
    app.style.setProperty("--assist", `${layout.assistantWidth}px`);
    app.classList.toggle("assistant-embedded", layout.placement === "embedded");
    app.classList.toggle("assistant-toggleable", layout.canToggle);

    const wantDetached = layout.placement === "detached";
    if (wantDetached !== detachedShown) {
      detachedShown = wantDetached;
      void invoke("set_assistant_window", { show: wantDetached });
    }
  }

  return {
    apply,
    setOpen(value) {
      open = value;
      apply();
    },
    toggleSticky() {
      sticky = sticky === "embedded" ? "detached" : "embedded";
      apply();
      return sticky;
    },
    canToggle: () => last?.canToggle ?? false,
  };
}
