// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./notes-state", () => ({
  loadNote: vi.fn(async () => "- [ ] Existing action\n"),
  saveImmediate: vi.fn(async () => undefined),
}));

import { createTasksPanel } from "./tasks-panel";

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

describe("action panel Escape priority", () => {
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("cancels a new action before closing its open action menu", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    const app = document.createElement("div");
    app.id = "app";
    document.body.appendChild(app);
    const panel = createTasksPanel(app, {
      tasksPath: () => "/tmp/_tasks.md",
      onOpenChange: vi.fn(),
    });

    panel.setOpen(true);
    await Promise.resolve();

    app.querySelector<HTMLButtonElement>(".tasks-more")!.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(app.querySelector(".tasks-menu")).not.toBeNull();

    app.querySelector<HTMLButtonElement>(".tasks-add-icon")!.click();
    const input = app.querySelector<HTMLInputElement>(".tasks-input")!;
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));

    expect(app.querySelector<HTMLFormElement>(".tasks-add")!.hidden).toBe(true);
    expect(app.querySelector(".tasks-menu")).not.toBeNull();
    expect(document.activeElement).not.toBe(input);

    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    }));

    expect(app.querySelector(".tasks-menu")).toBeNull();
  });
});
