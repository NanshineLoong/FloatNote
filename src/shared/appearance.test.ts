import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAppearance, normalizeTheme } from "./appearance";

describe("appearance", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { documentElement: { dataset: {} } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes missing and unsupported themes to system", () => {
    expect(normalizeTheme(undefined)).toBe("system");
    expect(normalizeTheme("sepia")).toBe("system");
  });

  it("applies the selected theme to the document root", () => {
    applyAppearance("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
