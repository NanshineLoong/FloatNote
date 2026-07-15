// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createProjectMenuRenderer } from "./project-menu-render";

describe("project menu renderer", () => {
  it("does not submit a rename while an IME confirms text", async () => {
    const closeMenu = vi.fn();
    const renderer = createProjectMenuRenderer({
      closeMenu,
      closeSubmenu: vi.fn(),
      openSubmenu: vi.fn(),
      isSubmenuOpenFor: () => false,
    });
    const host = document.createElement("div");
    document.body.append(host);
    const commit = vi.fn().mockResolvedValue(undefined);
    renderer.promptRename(host, "旧名称", commit);
    const input = document.querySelector<HTMLInputElement>(".switch-new-input")!;
    input.value = "新名称";

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
    expect(commit).not.toHaveBeenCalled();
    expect(closeMenu).not.toHaveBeenCalled();

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(commit).toHaveBeenCalledWith("新名称"));
  });

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
});
