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

interface InertSnapshot {
  element: HTMLElement;
  hadAttribute: boolean;
}

const LARGE_CLASS = "fn-input-large";

export function mountInputOverlay(opts: InputOverlayOptions): InputOverlayHandle {
  const { host, getDockHost, getView, onCollapse, onLargeChange } = opts;
  const layer = document.createElement("div");
  layer.className = "fn-input-overlay";
  layer.hidden = true;
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", "AI 助手输入");

  const backdrop = document.createElement("div");
  backdrop.className = "fn-input-overlay-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  const paper = document.createElement("div");
  paper.className = "fn-input-paper";
  layer.append(backdrop, paper);
  document.body.appendChild(layer);

  let large = false;
  let destroyed = false;
  let originalParent: Node | null = null;
  let originalNextSibling: Node | null = null;
  let inertSnapshots: InertSnapshot[] = [];
  let scheduledFrame: number | null = null;

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

  function disableBackground(): void {
    inertSnapshots = [...document.body.children]
      .filter((element): element is HTMLElement =>
        element instanceof HTMLElement
        && element !== layer
        && !element.classList.contains("fn-ref-popover")
        && !element.classList.contains("toast"))
      .map((element) => ({ element, hadAttribute: element.hasAttribute("inert") }));
    for (const snapshot of inertSnapshots) snapshot.element.setAttribute("inert", "");
  }

  function restoreBackground(): void {
    for (const snapshot of inertSnapshots) {
      if (!snapshot.hadAttribute) snapshot.element.removeAttribute("inert");
    }
    inertSnapshots = [];
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
    disableBackground();
    paper.appendChild(host);
    host.classList.add(LARGE_CLASS);
    layer.hidden = false;
    onLargeChange?.(true);
    scheduleLayout();
  }

  function collapse(): void {
    if (!large) return;
    large = false;
    restoreHost();
    restoreBackground();
    host.classList.remove(LARGE_CLASS);
    layer.hidden = true;
    onLargeChange?.(false);
    scheduleLayout();
    onCollapse?.();
  }

  function onDocumentKeyDown(event: KeyboardEvent): void {
    if (!large || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      collapse();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [...paper.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), '
      + 'select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
    )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (active === first || !paper.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !paper.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function destroy(): void {
    if (destroyed) return;
    if (large) {
      large = false;
      restoreHost();
      restoreBackground();
    }
    destroyed = true;
    if (scheduledFrame !== null) cancelAnimationFrame(scheduledFrame);
    scheduledFrame = null;
    document.removeEventListener("keydown", onDocumentKeyDown);
    observer?.disconnect();
    host.classList.remove(LARGE_CLASS);
    layer.remove();
  }

  document.addEventListener("keydown", onDocumentKeyDown);

  return {
    expand,
    collapse,
    isLarge: () => large,
    toggle: () => (large ? collapse() : expand()),
    destroy,
  };
}
