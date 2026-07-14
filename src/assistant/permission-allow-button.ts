import { createButton } from "../shared/ui/button";
import { createMenu } from "../shared/ui/menu";
import type { WriteMode } from "./permission-model";

export interface PermissionAllowButtonOptions {
  canSnapshot: boolean;
  disabled: boolean;
  resolve: (mode: WriteMode) => void;
  registerPortalRoot?: (root: HTMLElement) => () => void;
}

export interface PermissionAllowButtonHandle {
  el: HTMLElement;
  setDisabled: (disabled: boolean) => void;
  closeMenu: () => void;
  destroy: () => void;
}

export function createPermissionAllowButton(options: PermissionAllowButtonOptions): PermissionAllowButtonHandle {
  const el = document.createElement("div");
  el.className = options.canSnapshot ? "perm-allow-split" : "perm-allow";
  let disabled = options.disabled;
  let resolved = false;
  let unregisterPortal: (() => void) | null = null;
  let arrow: HTMLButtonElement | null = null;
  const menu = createMenu({
    anchor: el,
    placement: "up-right",
    inside: [el],
    onOutside: () => {
      arrow?.setAttribute("aria-expanded", "false");
      unregisterPortal?.();
      unregisterPortal = null;
    },
  });

  function resolve(mode: WriteMode): void {
    if (disabled || resolved) return;
    resolved = true;
    closeMenu();
    options.resolve(mode);
  }

  const main = createButton({ variant: "primary", label: "允许写入", disabled, onClick: () => resolve("direct") });
  main.classList.add("perm-allow-main");
  el.appendChild(main);

  function closeMenu(): void {
    menu.hide();
    arrow?.setAttribute("aria-expanded", "false");
    unregisterPortal?.();
    unregisterPortal = null;
  }

  if (options.canSnapshot) {
    arrow = createButton({ variant: "primary", icon: "ph-caret-down", iconOnly: true, label: "其他写入方式", disabled });
    arrow.classList.add("perm-allow-arrow");
    arrow.setAttribute("aria-haspopup", "menu");
    arrow.setAttribute("aria-expanded", "false");
    arrow.addEventListener("click", () => {
      if (disabled || resolved) return;
      if (menu.isOpen()) {
        closeMenu();
        return;
      }
      const item = document.createElement("button");
      item.type = "button";
      item.className = "fn-menu__item";
      item.setAttribute("role", "menuitem");
      item.textContent = "保存快照后写入";
      item.addEventListener("click", () => resolve("snapshot"));
      menu.show(item);
      menu.el.setAttribute("role", "menu");
      menu.el.onkeydown = (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
        arrow?.focus();
      };
      unregisterPortal = options.registerPortalRoot?.(menu.el) ?? null;
      arrow?.setAttribute("aria-expanded", "true");
      item.focus();
    });
    el.appendChild(arrow);
  }

  return {
    el,
    setDisabled(value) {
      disabled = value;
      if (!value) resolved = false;
      for (const button of el.querySelectorAll<HTMLButtonElement>("button")) button.disabled = value;
      if (value) closeMenu();
    },
    closeMenu,
    destroy() {
      closeMenu();
      menu.destroy();
      el.remove();
    },
  };
}
