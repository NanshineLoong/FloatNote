import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));

describe("selection popup window", () => {
  it("does not focus when shown but accepts an intentional first click", () => {
    const popup = config.app.windows.find((window: { label: string }) => window.label === "selection-popup");
    expect(popup.focus).toBe(false);
    expect(popup.focusable).toBe(true);
    expect(popup.acceptFirstMouse).toBe(true);
  });
});
