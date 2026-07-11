// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { bindSwitchRowHover, createProjectMenuRenderer } from "./project-menu-render";

describe("project menu renderer", () => {
  it("opens and closes the section add submenu from its trigger", () => {
    const openSubmenu = vi.fn();
    const closeSubmenu = vi.fn();
    const renderer = createProjectMenuRenderer({
      closeMenu: vi.fn(),
      closeSubmenu,
      openSubmenu,
      isSubmenuOpenFor: () => false,
    });

    const header = renderer.sectionHeader("ph-folder", "项目", {
      ariaLabel: "新建项目",
      onOpen: (trigger) => openSubmenu(trigger, []),
    });
    const add = header.querySelector<HTMLButtonElement>("button")!;
    add.click();

    expect(openSubmenu).toHaveBeenCalledWith(add, []);

    const expandedRenderer = createProjectMenuRenderer({
      closeMenu: vi.fn(),
      closeSubmenu,
      openSubmenu,
      isSubmenuOpenFor: () => true,
    });
    const expandedHeader = expandedRenderer.sectionHeader("ph-folder", "项目", {
      ariaLabel: "新建项目",
      onOpen: vi.fn(),
    });
    const expandedAdd = expandedHeader.querySelector<HTMLButtonElement>("button")!;
    expandedAdd.click();

    expect(closeSubmenu).toHaveBeenCalled();
  });

  it("opens a row and exposes row actions through the kebab submenu", () => {
    const openSubmenu = vi.fn();
    const onOpen = vi.fn();
    const onAction = vi.fn();
    const renderer = createProjectMenuRenderer({
      closeMenu: vi.fn(),
      closeSubmenu: vi.fn(),
      openSubmenu,
      isSubmenuOpenFor: () => false,
    });

    const row = renderer.makeSwitcherRow({
      label: "项目 A",
      onOpen,
      actions: [{ label: "删除", icon: "ph-trash", danger: true, onClick: onAction }],
    });
    row.querySelector<HTMLButtonElement>(".switch-row-label")!.click();
    const kebab = row.querySelector<HTMLButtonElement>(".switch-row-kebab")!;
    kebab.click();

    expect(onOpen).toHaveBeenCalledOnce();
    expect(openSubmenu).toHaveBeenCalledOnce();
    const items = openSubmenu.mock.calls[0][1] as HTMLElement[];
    expect(items[0].classList.contains("danger")).toBe(true);
    items[0].click();
    expect(onAction).toHaveBeenCalledWith(row);
  });

  it("toggles is-hovered on mouseenter/mouseleave and keeps only one row lit", () => {
    const menu = document.createElement("div");
    const rowA = document.createElement("div");
    const rowB = document.createElement("div");
    rowA.className = rowB.className = "switch-row";
    menu.append(rowA, rowB);
    bindSwitchRowHover(rowA);
    bindSwitchRowHover(rowB);

    // 显隐改由 is-hovered 类驱动（不再用 CSS :hover），离开时必须可靠清除。
    rowA.dispatchEvent(new Event("mouseenter"));
    expect(rowA.classList.contains("is-hovered")).toBe(true);

    // 进入相邻行时，前一行必须被清掉——这是"多行残留"bug 的核心防护。
    rowB.dispatchEvent(new Event("mouseenter"));
    expect(rowB.classList.contains("is-hovered")).toBe(true);
    expect(rowA.classList.contains("is-hovered")).toBe(false);

    // 离开菜单时最后一行的类也要清除。
    rowB.dispatchEvent(new Event("mouseleave"));
    expect(rowB.classList.contains("is-hovered")).toBe(false);
  });
});
