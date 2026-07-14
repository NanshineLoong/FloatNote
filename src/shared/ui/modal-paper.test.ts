// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createModalPaper } from "./modal-paper";

afterEach(() => document.body.replaceChildren());

describe("createModalPaper", () => {
  it("makes background inert, traps focus, and restores prior inert state and focus", () => {
    const before = document.createElement("button");
    const alreadyInert = document.createElement("div");
    alreadyInert.setAttribute("inert", "");
    document.body.append(before, alreadyInert);
    before.focus();
    const modal = createModalPaper({ ariaLabel: "Review" });
    const first = document.createElement("button");
    const last = document.createElement("button");
    modal.paper.append(first, last);

    modal.open();
    expect(before.hasAttribute("inert")).toBe(true);
    last.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(first);

    modal.close();
    expect(before.hasAttribute("inert")).toBe(false);
    expect(alreadyInert.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(before);
  });

  it("treats a registered body portal as part of the focus boundary", () => {
    const modal = createModalPaper({ ariaLabel: "Review" });
    const paperButton = document.createElement("button");
    const portal = document.createElement("div");
    const portalButton = document.createElement("button");
    portal.appendChild(portalButton);
    document.body.appendChild(portal);
    modal.paper.appendChild(paperButton);
    modal.registerPortalRoot(portal);
    modal.open();
    portalButton.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(paperButton);
  });

  it("delegates Escape without reacting to prevented events and cleans listeners", () => {
    const onEscape = vi.fn();
    const modal = createModalPaper({ ariaLabel: "Review", onEscape });
    modal.open();
    const prevented = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    prevented.preventDefault();
    document.dispatchEvent(prevented);
    expect(onEscape).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onEscape).toHaveBeenCalledOnce();
    modal.destroy();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onEscape).toHaveBeenCalledOnce();
  });
});
