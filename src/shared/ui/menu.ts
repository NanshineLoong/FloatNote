/**
 * Shared menu / dropdown. Pragmatic unification of three existing impls:
 *  - `src/shared/ui/floating-menu.ts` (floatMenu/floatMenuAnchored/closeFloating)
 *  - `src/assistant/dock-dropdown.ts` (createDockDropdown)
 *  - `src/note/project-menu-render.ts` (submenu lifecycle)
 *
 * Ships unused this round; `floating-menu.ts` ports first (lowest risk), then
 * `dock-dropdown`, then `project-menu-render` submenus (highest risk). CSS is
 * `.fn-menu*` in `src/styles/components.css`.
 */

export type MenuPlacement = "up" | "up-left" | "up-right" | "free";

export interface MenuOptions {
  /** Anchor for an anchored placement; ignored in "free" (use showAt). */
  anchor?: HTMLElement | DOMRect;
  /** Docked mode: append here instead of document.body. */
  parent?: HTMLElement;
  /** Elements treated as inside (do not close on pointerdown within). */
  inside?: HTMLElement[];
  placement?: MenuPlacement;
  onOutside?: () => void;
}

export interface MenuHandle {
  el: HTMLElement;
  /** Show anchored to `opts.anchor` (or docked in `opts.parent`). */
  show(content: HTMLElement | HTMLElement[]): void;
  /** Show at viewport coords (free placement). */
  showAt(x: number, y: number, content: HTMLElement | HTMLElement[]): void;
  hide(): void;
  isOpen(): boolean;
  openSubmenu(trigger: HTMLElement, items: HTMLElement[]): void;
  closeSubmenu(): void;
  isSubmenuOpenFor(trigger: HTMLElement): boolean;
  destroy(): void;
}

export function createMenu(opts: MenuOptions = {}): MenuHandle {
  const { anchor, parent, inside = [], placement = "free", onOutside } = opts;
  const host = parent ?? document.body;
  const el = document.createElement("div");
  el.className = "fn-menu";
  el.hidden = true;

  let submenu: HTMLElement | null = null;
  let submenuTrigger: HTMLElement | null = null;
  let outsideBound: ((e: PointerEvent) => void) | null = null;

  function armOutsideClose(): void {
    if (outsideBound) return;
    outsideBound = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (el.contains(target)) return;
      if (inside.some((n) => n.contains(target))) return;
      if (submenu?.contains(target)) return;
      hide();
      onOutside?.();
    };
    setTimeout(
      () => document.addEventListener("pointerdown", outsideBound!, { once: true }),
      0,
    );
  }

  function clamp(left: number, top: number): { left: number; top: number } {
    const margin = 8;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let l = left;
    let t = top;
    if (Number.isFinite(vw) && rect.width + margin * 2 < vw) {
      if (l + rect.width + margin > vw) l = vw - rect.width - margin;
      if (l < margin) l = margin;
    } else if (Number.isFinite(vw)) {
      l = margin;
    }
    if (Number.isFinite(vh) && rect.height + margin * 2 < vh) {
      if (t + rect.height + margin > vh) t = vh - rect.height - margin;
      if (t < margin) t = margin;
    } else if (Number.isFinite(vh)) {
      t = margin;
    }
    return { left: l, top: t };
  }

  function placeFromAnchor(): void {
    if (!anchor) return;
    const rect = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    const gap = 6;
    const { height, width } = el.getBoundingClientRect();
    let top = rect.top - gap - height;
    if (top < 8) top = rect.bottom + gap;
    let left =
      placement === "up-right"
        ? rect.right + gap
        : placement === "up-left"
          ? rect.left - gap - width
          : rect.left;
    const c = clamp(left, top);
    el.style.left = `${c.left}px`;
    el.style.top = `${c.top}px`;
  }

  function mount(content: HTMLElement | HTMLElement[]): void {
    el.innerHTML = "";
    const nodes = Array.isArray(content) ? content : [content];
    for (const n of nodes) el.appendChild(n);
    host.appendChild(el);
    el.hidden = false;
  }

  function show(content: HTMLElement | HTMLElement[]): void {
    mount(content);
    if (placement !== "free" || anchor) placeFromAnchor();
    armOutsideClose();
  }

  function showAt(x: number, y: number, content: HTMLElement | HTMLElement[]): void {
    mount(content);
    const c = clamp(x, y);
    el.style.left = `${c.left}px`;
    el.style.top = `${c.top}px`;
    armOutsideClose();
  }

  function hide(): void {
    el.hidden = true;
    closeSubmenu();
    if (el.parentElement) el.parentElement.removeChild(el);
    if (outsideBound) {
      document.removeEventListener("pointerdown", outsideBound);
      outsideBound = null;
    }
  }

  function isOpen(): boolean {
    return !el.hidden;
  }

  function openSubmenu(trigger: HTMLElement, items: HTMLElement[]): void {
    closeSubmenu();
    submenuTrigger = trigger;
    submenu = document.createElement("div");
    submenu.className = "fn-menu fn-menu__submenu";
    for (const it of items) submenu.appendChild(it);
    document.body.appendChild(submenu);
    const r = trigger.getBoundingClientRect();
    const c = clamp(r.right + 6, r.top);
    submenu.style.left = `${c.left}px`;
    submenu.style.top = `${c.top}px`;
  }

  function closeSubmenu(): void {
    submenu?.remove();
    submenu = null;
    submenuTrigger = null;
  }

  function isSubmenuOpenFor(trigger: HTMLElement): boolean {
    return submenuTrigger === trigger;
  }

  el.addEventListener("pointerdown", (e) => e.stopPropagation());

  return {
    el,
    show,
    showAt,
    hide,
    isOpen,
    openSubmenu,
    closeSubmenu,
    isSubmenuOpenFor,
    destroy: hide,
  };
}
