import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { nextTagFilter } from "./bar";

const source = readFileSync(resolve(process.cwd(), "src/note/tags/bar.ts"), "utf8");

describe("nextTagFilter", () => {
  it("activates the clicked tag when no filter is active", () => {
    expect(nextTagFilter(null, "todo")).toBe("todo");
  });

  it("clears the filter when the active tag is clicked again", () => {
    expect(nextTagFilter("todo", "todo")).toBeNull();
  });

  it("switches from one tag to another", () => {
    expect(nextTagFilter("todo", "idea")).toBe("idea");
  });
});

describe("tag bar read-only status", () => {
  it("renders a right-aligned read-only hint while a tag filter is active", () => {
    expect(source).toContain("tag-readonly-hint");
    expect(source).toContain("只读视图");
    expect(source).toContain("ph-lock");
  });
});
