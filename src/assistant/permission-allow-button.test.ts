// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPermissionAllowButton } from "./permission-allow-button";

afterEach(() => document.body.replaceChildren());

describe("createPermissionAllowButton", () => {
  it("resolves direct mode from the main action exactly once", () => {
    const resolve = vi.fn();
    const control = createPermissionAllowButton({ canSnapshot: false, disabled: false, resolve });
    document.body.appendChild(control.el);
    control.el.querySelector<HTMLButtonElement>("button")!.click();
    control.el.querySelector<HTMLButtonElement>("button")!.click();
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith("direct");
  });

  it("opens an accessible snapshot menu without resolving, then resolves immediately", () => {
    const resolve = vi.fn();
    const control = createPermissionAllowButton({ canSnapshot: true, disabled: false, resolve });
    document.body.appendChild(control.el);
    const arrow = control.el.querySelector<HTMLButtonElement>("[aria-haspopup='menu']")!;
    arrow.click();
    expect(resolve).not.toHaveBeenCalled();
    expect(arrow.getAttribute("aria-expanded")).toBe("true");
    const item = document.querySelector<HTMLButtonElement>(".fn-menu__item")!;
    expect(document.activeElement).toBe(item);
    item.click();
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith("snapshot");
  });
});
