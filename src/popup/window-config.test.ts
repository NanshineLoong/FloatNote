import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const rustWindowSource = readFileSync(new URL("../../src-tauri/src/windows.rs", import.meta.url), "utf8");
const rustAppSource = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
const cargoSource = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");

describe("selection popup window", () => {
  it("does not focus when shown but accepts an intentional first click", () => {
    const popup = config.app.windows.find((window: { label: string }) => window.label === "selection-popup");
    expect(popup.focus).toBe(false);
    expect(popup.focusable).toBe(true);
    expect(popup.acceptFirstMouse).toBe(true);
  });

  it("enables macOS mouse-moved events so passive popup buttons can hover", () => {
    expect(cargoSource).toContain('"NSWindow"');
    expect(cargoSource).toContain('"NSResponder"');
    expect(rustWindowSource).toContain("setAcceptsMouseMovedEvents(true)");
    expect(rustAppSource).toContain("enable_popup_mouse_moved_events");
  });
});
