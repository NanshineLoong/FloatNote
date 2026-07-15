/**
 * Shared menu / dropdown. Unifies the former per-window float/menu impls:
 *  - the old `floating-menu.ts` (floatMenu/floatMenuAnchored/closeFloating) — retired;
 *    tag context menus (tags/bar.ts), the block tag picker (tags/picker.ts), and the
 *    assistant skill right-click menu (skill-picker.ts) now use `createMenu`.
 *  - `src/assistant/dock-dropdown.ts` (createDockDropdown) and
 *    `src/note/project-menu-render.ts` submenu lifecycle migrate next.
 *
 * CSS is `.fn-menu*` in `src/styles/components.css`.
 *
 * Submenus mirror the old note-app behavior: Escape closes only the submenu
 * (main menu stays open) and focus moves to the first enabled item. A
 * module-level `currentMenu` keeps at most one body-hosted menu open at a time,
 * matching the old `closeFloating()` global sweep (docked menus are exempt).
 */

export type MenuPlacement = "up" | "up-left" | "up-right" | "down-right" | "free";

/**
 * Mutual-exclusion invariant (mirrors the old `closeFloating()` global sweep):
 * at most one body-hosted (free / anchored) menu is open at a time. Docked
 * menus (`opts.parent`) are exempt — they coexist like the old
 * `createDockDropdown`.
 */
let currentMenu: MenuHandle | null = null;

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
  // An HTMLElement anchor is itself a menu trigger. Treating it as an outside
  // click makes a second click close the menu on pointerdown and reopen it in
  // the trigger's click handler. DOMRect anchors have no DOM containment.
  const insideElements = anchor instanceof HTMLElement ? [...inside, anchor] : inside;
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
      if (insideElements.some((n) => n.contains(target))) return;
      if (submenu?.contains(target)) return;
      hide();
      onOutside?.();
    };
    // Keep the listener armed until an actual outside interaction. A submenu is
    // body-hosted, so clicking it does not bubble through `el`; using `{ once:
    // true }` would consume the listener on that valid inside interaction and
    // leave the parent menu unable to close afterwards.
    setTimeout(() => document.addEventListener("pointerdown", outsideBound!), 0);
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
    let top: number;
    let left: number;
    if (placement === "down-right") {
      // 下方右对齐：菜单顶边在 anchor 底边之下，右边对齐 anchor 右边
      // （如版本菜单挂在右上角的版本入口下方，向左展开）。
      top = rect.bottom + gap;
      left = rect.right - width;
    } else {
      top = rect.top - gap - height;
      if (top < 8) top = rect.bottom + gap;
      left =
        placement === "up-right"
          ? rect.right + gap
          : placement === "up-left"
            ? rect.left - gap - width
            : rect.left;
    }
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
    if (host === document.body && currentMenu && currentMenu !== handle) currentMenu.hide();
    mount(content);
    if (placement !== "free" || anchor) placeFromAnchor();
    armOutsideClose();
    if (host === document.body) currentMenu = handle;
  }

  function showAt(x: number, y: number, content: HTMLElement | HTMLElement[]): void {
    if (host === document.body && currentMenu && currentMenu !== handle) currentMenu.hide();
    mount(content);
    const c = clamp(x, y);
    el.style.left = `${c.left}px`;
    el.style.top = `${c.top}px`;
    armOutsideClose();
    if (host === document.body) currentMenu = handle;
  }

  function hide(): void {
    el.hidden = true;
    closeSubmenu();
    if (el.parentElement) el.parentElement.removeChild(el);
    if (outsideBound) {
      document.removeEventListener("pointerdown", outsideBound);
      outsideBound = null;
    }
    if (currentMenu === handle) currentMenu = null;
  }

  function isOpen(): boolean {
    return !el.hidden;
  }

  function openSubmenu(trigger: HTMLElement, items: HTMLElement[]): void {
    closeSubmenu();
    submenuTrigger = trigger;
    trigger.setAttribute("aria-expanded", "true");
    submenu = document.createElement("div");
    submenu.className = "fn-menu fn-menu__submenu";
    for (const it of items) submenu.appendChild(it);
    document.body.appendChild(submenu);
    const r = trigger.getBoundingClientRect();
    const { width: w, height: h } = submenu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // 右侧空间不足则翻到 trigger 左侧；下方不足则翻到 trigger 上方
    // （对齐旧 note-app 子菜单的 flip 逻辑，避免与主菜单重叠）。
    const left =
      Number.isFinite(vw) && r.right + 6 + w > vw
        ? Math.max(8, r.left - 6 - w)
        : r.right + 6;
    const top =
      Number.isFinite(vh) && r.bottom + h > vh ? Math.max(8, r.top - h) : r.bottom;
    submenu.style.left = `${left}px`;
    submenu.style.top = `${top}px`;
    // Esc closes only the submenu; the main menu stays open (mirrors the old
    // note-app submenu keydown handler).
    submenu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeSubmenu();
        trigger.focus();
      }
    });
    // Focus the first enabled item so keyboard nav works immediately.
    const first = items.find(
      (it) => !(it as HTMLButtonElement).disabled,
    ) as HTMLButtonElement | undefined;
    first?.focus();
  }

  function closeSubmenu(): void {
    if (submenuTrigger) submenuTrigger.setAttribute("aria-expanded", "false");
    submenu?.remove();
    submenu = null;
    submenuTrigger = null;
  }

  function isSubmenuOpenFor(trigger: HTMLElement): boolean {
    return submenuTrigger === trigger;
  }

  el.addEventListener("pointerdown", (e) => e.stopPropagation());

  const handle: MenuHandle = {
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
  return handle;
}
