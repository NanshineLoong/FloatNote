import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const rustWindowSource = readFileSync(new URL("../../src-tauri/src/windows.rs", import.meta.url), "utf8");
const rustAppSource = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");

describe("selection popup window", () => {
  it("does not focus when shown but accepts an intentional first click", () => {
    const popup = config.app.windows.find((window: { label: string }) => window.label === "selection-popup");
    expect(popup.focus).toBe(false);
    expect(popup.focusable).toBe(true);
    expect(popup.acceptFirstMouse).toBe(true);
  });

  it("does not duplicate Tao's native acceptsMouseMovedEvents setting", () => {
    expect(rustWindowSource).not.toContain("setAcceptsMouseMovedEvents(true)");
    expect(rustAppSource).not.toContain("enable_popup_mouse_moved_events");
  });
});
