import { describe, expect, it } from "vitest";
import { TOAST_STYLE } from "./toast";

describe("toast style", () => {
  it("wraps long messages within the viewport", () => {
    expect(TOAST_STYLE).toContain("max-width: min(360px, calc(100vw - 32px))");
    expect(TOAST_STYLE).toContain("white-space: normal");
    expect(TOAST_STYLE).toContain("overflow-wrap: anywhere");
  });
});
