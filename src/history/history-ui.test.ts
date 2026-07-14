// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { createButton } from "../shared/ui/button";
import { createClearAllHistoryItem, createHistoryMoreButton } from "./history-ui";

describe("createHistoryMoreButton", () => {
  it("uses a dedicated class so it remains distinct from toolbar buttons", () => {
    const toolbar = document.createElement("nav");
    toolbar.append(createButton({ variant: "secondary", icon: "ph-broom", iconOnly: true }));
    const main = document.createElement("main");
    main.append(toolbar, createHistoryMoreButton());

    expect(main.querySelector<HTMLButtonElement>(".history-more")).toBe(main.lastElementChild);
    expect(main.querySelector<HTMLButtonElement>(".history-more")).not.toBe(toolbar.querySelector(".fn-btn"));
  });
});

describe("createClearAllHistoryItem", () => {
  it("renders a destructive clear-all action and invokes its callback", () => {
    const onClear = vi.fn();
    const item = createClearAllHistoryItem(onClear);

    expect(item.classList.contains("fn-menu__item")).toBe(true);
    expect(item.classList.contains("history-delete")).toBe(true);
    expect(item.textContent).toBe("清理全部对话记录");
    item.click();
    expect(onClear).toHaveBeenCalledOnce();
  });
});
