import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("selection popup settings", () => {
  it("offers auto, shortcut-only, and off without modifier mode", () => {
    expect(source).toContain('<option value="auto"');
    expect(source).toContain('<option value="shortcut"');
    expect(source).toContain('<option value="off"');
    expect(source).not.toContain('<option value="modifier"');
    expect(source).not.toContain('<option value="every"');
  });
});
