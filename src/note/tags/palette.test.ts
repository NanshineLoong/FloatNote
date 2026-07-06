import { describe, it, expect } from "vitest";
import { PALETTE, tint } from "./palette";

describe("palette", () => {
  it("exposes a non-empty curated set of distinct colors", () => {
    expect(PALETTE.length).toBeGreaterThanOrEqual(8);
    const colors = new Set(PALETTE.map((s) => s.color));
    expect(colors.size).toBe(PALETTE.length);
  });
});

describe("tint", () => {
  it("derives an rgba string at ~12% alpha from a hex color", () => {
    expect(tint("#e5484d")).toBe("rgba(229, 72, 77, 0.12)");
  });
  it("expands short hex", () => {
    expect(tint("#f00")).toBe("rgba(255, 0, 0, 0.12)");
  });
  it("alpha is configurable", () => {
    expect(tint("#000000", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
  });
});
