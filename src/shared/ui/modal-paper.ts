interface InertSnapshot {
  element: HTMLElement;
  hadAttribute: boolean;
}

export interface ModalPaperOptions {
  ariaLabel: string;
  layerClass?: string;
  backdropClass?: string;
  paperClass?: string;
  onEscape?: () => void;
}

export interface ModalPaperHandle {
  layer: HTMLElement;
  backdrop: HTMLElement;
  paper: HTMLElement;
  open: (options?: { restoreFocus?: boolean }) => void;
  close: (options?: { restoreFocus?: boolean }) => void;
  isOpen: () => boolean;
  registerPortalRoot: (root: HTMLElement) => () => void;
  destroy: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), '
  + 'select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

export function createModalPaper(options: ModalPaperOptions): ModalPaperHandle {
  const layer = document.createElement("div");
  layer.className = options.layerClass ?? "fn-modal-layer";
  layer.hidden = true;
  layer.setAttribute("role", "dialog");
  layer.setAttribute("aria-modal", "true");
  layer.setAttribute("aria-label", options.ariaLabel);
  const backdrop = document.createElement("div");
  backdrop.className = options.backdropClass ?? "fn-modal-backdrop";
  backdrop.setAttribute("aria-hidden", "true");
  const paper = document.createElement("div");
  paper.className = options.paperClass ?? "fn-modal-paper";
  layer.append(backdrop, paper);
  document.body.appendChild(layer);

  const portals = new Set<HTMLElement>();
  let snapshots: InertSnapshot[] = [];
  let open = false;
  let destroyed = false;
  let restoreTarget: HTMLElement | null = null;
  let shouldRestoreFocus = true;

  function roots(): HTMLElement[] {
    return [paper, ...portals].filter((root) => root.isConnected && !root.hidden);
  }

  function focusable(): HTMLElement[] {
    return roots().flatMap((root) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)])
      .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
  }

  function disableBackground(): void {
    snapshots = [...document.body.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== layer && !portals.has(element))
      .map((element) => ({ element, hadAttribute: element.hasAttribute("inert") }));
    for (const snapshot of snapshots) snapshot.element.setAttribute("inert", "");
  }

  function restoreBackground(): void {
    for (const snapshot of snapshots) if (!snapshot.hadAttribute) snapshot.element.removeAttribute("inert");
    snapshots = [];
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!open || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      options.onEscape?.();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable();
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const active = document.activeElement;
    const activeIndex = items.findIndex((item) => item === active);
    if (event.shiftKey && activeIndex <= 0) {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (!event.shiftKey && (activeIndex < 0 || activeIndex === items.length - 1)) {
      event.preventDefault();
      items[0].focus();
    }
  }

  document.addEventListener("keydown", onKeyDown);

  const handle: ModalPaperHandle = {
    layer,
    backdrop,
    paper,
    open(options = {}) {
      if (open || destroyed) return;
      open = true;
      shouldRestoreFocus = options.restoreFocus ?? true;
      restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      disableBackground();
      layer.hidden = false;
    },
    close(options = {}) {
      if (!open) return;
      open = false;
      layer.hidden = true;
      restoreBackground();
      if ((options.restoreFocus ?? shouldRestoreFocus) && restoreTarget?.isConnected) restoreTarget.focus();
      restoreTarget = null;
    },
    isOpen: () => open,
    registerPortalRoot(root) {
      portals.add(root);
      if (open) {
        const snapshot = snapshots.find((entry) => entry.element === root);
        if (snapshot && !snapshot.hadAttribute) root.removeAttribute("inert");
      }
      return () => portals.delete(root);
    },
    destroy() {
      if (destroyed) return;
      handle.close({ restoreFocus: false });
      destroyed = true;
      document.removeEventListener("keydown", onKeyDown);
      portals.clear();
      layer.remove();
    },
  };
  return handle;
}
