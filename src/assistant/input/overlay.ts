/**
 * 顶层聚焦纸张 portal。
 *
 * 展开时把同一个输入器宿主移动到 body 下的纸张容器，收起时再插回原来的
 * DOM 位置。EditorView 从未重建，因此文本、选区、历史与 IME 状态自然保留。
 */
export interface InputOverlayOptions {
  /** 输入器宿主（.assistant-input-wrap）。 */
  host: HTMLElement;
  /** 原父节点失效时，返回当前助手 dock 作为恢复位置。 */
  getDockHost: () => HTMLElement;
  /** 展开、尺寸变化与收回后让 CM6 重测布局。 */
  getView: () => { requestMeasure: () => void; focus: () => void } | null;
  /** 收回时回调。 */
  onCollapse?: () => void;
  /** 展开状态变化时回调。 */
  onLargeChange?: (large: boolean) => void;
}

export interface InputOverlayHandle {
  expand: () => void;
  collapse: () => void;
  isLarge: () => boolean;
  toggle: () => void;
  destroy: () => void;
}

const LARGE_CLASS = "fn-input-large";

export function mountInputOverlay(opts: InputOverlayOptions): InputOverlayHandle {
  const { host, getDockHost, getView, onCollapse, onLargeChange } = opts;
  const modal = createModalPaper({
    ariaLabel: "AI 助手输入",
    layerClass: "fn-input-overlay",
    backdropClass: "fn-input-overlay-backdrop",
    paperClass: "fn-input-paper",
    onEscape: collapse,
  });
  const { paper } = modal;

  let large = false;
  let destroyed = false;
  let originalParent: Node | null = null;
  let originalNextSibling: Node | null = null;
  let scheduledFrame: number | null = null;
  let unregisterPortals: Array<() => void> = [];

  const observer = typeof ResizeObserver === "undefined"
    ? null
    : new ResizeObserver(() => {
      if (large) getView()?.requestMeasure();
    });
  observer?.observe(paper);

  function scheduleLayout(): void {
    if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
    scheduledFrame = requestAnimationFrame(() => {
      scheduledFrame = null;
      if (destroyed) return;
      const view = getView();
      view?.requestMeasure();
      view?.focus();
    });
  }

  function restoreHost(): void {
    const parent = originalParent instanceof HTMLElement && originalParent.isConnected
      ? originalParent
      : getDockHost();
    if (originalNextSibling?.parentNode === parent) parent.insertBefore(host, originalNextSibling);
    else parent.appendChild(host);
    originalParent = null;
    originalNextSibling = null;
  }

  function expand(): void {
    if (large || destroyed) return;
    large = true;
    originalParent = host.parentNode;
    originalNextSibling = host.nextSibling;
    unregisterPortals = [...document.querySelectorAll<HTMLElement>(".fn-ref-popover, .toast")]
      .map((root) => modal.registerPortalRoot(root));
    paper.appendChild(host);
    host.classList.add(LARGE_CLASS);
    modal.open({ restoreFocus: false });
    onLargeChange?.(true);
    scheduleLayout();
  }

  function collapse(): void {
    if (!large) return;
    large = false;
    restoreHost();
    modal.close({ restoreFocus: false });
    unregisterPortals.forEach((unregister) => unregister());
    unregisterPortals = [];
    host.classList.remove(LARGE_CLASS);
    onLargeChange?.(false);
    scheduleLayout();
    onCollapse?.();
  }

  function destroy(): void {
    if (destroyed) return;
    if (large) {
      large = false;
      restoreHost();
      modal.close({ restoreFocus: false });
    }
    destroyed = true;
    if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
    scheduledFrame = null;
    observer?.disconnect();
    host.classList.remove(LARGE_CLASS);
    unregisterPortals.forEach((unregister) => unregister());
    unregisterPortals = [];
    modal.destroy();
  }

  return {
    expand,
    collapse,
    isLarge: () => large,
    toggle: () => (large ? collapse() : expand()),
    destroy,
  };
}
import { createModalPaper } from "../../shared/ui/modal-paper";
