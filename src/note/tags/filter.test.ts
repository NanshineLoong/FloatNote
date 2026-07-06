import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { hiddenBlockRanges } from "./filter";

describe("hiddenBlockRanges", () => {
  const doc =
    `<!-- floatnote-tags: concept="概念"|c=#e5484d; todo="待办"|c=#f5a623 -->\n` +
    `第一段<!-- floatnote:tag=concept -->\n\n` +
    `第二段<!-- floatnote:tag=todo -->\n\n` +
    `第三段<!-- floatnote:tag=concept -->\n\n` +
    `无标签段`;

  it("hides everything except matching blocks when a filter is active", () => {
    const ranges = hiddenBlockRanges(doc, "concept");
    // matching blocks: 第一段, 第三段. Hidden: 第二段, 无标签段 → 2 ranges.
    expect(ranges.length).toBe(2);
    const hiddenTexts = ranges.map((r) => doc.slice(r.from, r.to));
    expect(hiddenTexts).toContain("第二段<!-- floatnote:tag=todo -->");
    expect(hiddenTexts).toContain("无标签段");
    expect(hiddenTexts).not.toContain("第一段<!-- floatnote:tag=concept -->");
  });

  it("hides nothing when the filter is null", () => {
    expect(hiddenBlockRanges(doc, null)).toEqual([]);
  });

  it("hides everything when the active tag matches no block", () => {
    const ranges = hiddenBlockRanges(doc, "nope");
    expect(ranges.length).toBe(4);
  });
});

describe("tagFilter extension wiring", () => {
  it("provides block replacement decorations directly from a StateField", () => {
    const source = readFileSync(resolve(process.cwd(), "src/note/tags/filter.ts"), "utf8");
    expect(source).toMatch(/provide:\s*\(?\w+\)?\s*=>\s*EditorView\.decorations\.from\(/);
    expect(source).not.toMatch(/ViewPlugin\.fromClass/);
  });

  it("hides filtered-out blocks without rendering placeholder dots", () => {
    const source = readFileSync(resolve(process.cwd(), "src/note/tags/filter.ts"), "utf8");
    expect(source).toMatch(/Decoration\.replace\(\{\s*block:\s*true\s*\}\)/);
    expect(source).not.toMatch(/WidgetType/);
    expect(source).not.toContain("cm-tag-collapsed");
  });

  it("makes the editor read-only while a tag filter is active", () => {
    const source = readFileSync(resolve(process.cwd(), "src/note/tags/filter.ts"), "utf8");
    expect(source).toMatch(/EditorState\.readOnly\.compute/);
    expect(source).toMatch(/activeTagFilter\(state\)\s*!==\s*null/);
  });
});
