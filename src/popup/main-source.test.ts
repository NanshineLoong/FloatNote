import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("selection popup window lifecycle", () => {
  it("never asks Tauri to focus the passive popup", () => {
    expect(source).not.toContain(".setFocus(");
  });

  it("resizes from measured content instead of fixed constants", () => {
    expect(source).toContain("getBoundingClientRect");
    expect(source).toContain("setSize");
    expect(source).not.toContain("POPUP_W");
    expect(source).not.toContain("POPUP_H");
  });

  it("defensively suppresses empty automatic payloads", () => {
    expect(source).toContain('payload.origin === "auto" && !payload.hasText');
  });
});
