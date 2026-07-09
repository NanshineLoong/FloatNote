import { describe, it, expect } from "vitest";
import { replaceOnce, findBlockByAnchor } from "./matching.js";

describe("replaceOnce", () => {
  it("replaces a unique match", () => {
    const r = replaceOnce("a\nb\nc", "b", "B");
    expect(r).toEqual({ ok: true, newContent: "a\nB\nc" });
  });
  it("rejects zero matches", () => {
    expect(replaceOnce("a\nb", "z", "Z")).toEqual({ ok: false, error: expect.any(String) });
  });
  it("rejects multiple matches", () => {
    expect(replaceOnce("a a a", "a", "b")).toEqual({ ok: false, error: expect.any(String) });
  });
});

describe("findBlockByAnchor", () => {
  it("locates a block by unique prefix", () => {
    const doc = "第一块\n\n第二块\n\n第三块";
    const r = findBlockByAnchor(doc, "第二");
    expect(r.ok).toBe(true);
    expect(doc.slice((r as any).range.from, (r as any).range.to)).toBe("第二块");
  });
  it("strips tag markers before matching", () => {
    const doc = "第一块<!-- floatnote:tag=review -->\n\n第二块";
    const r = findBlockByAnchor(doc, "第一块");
    expect(r.ok).toBe(true);
  });
  it("rejects non-unique anchor", () => {
    const doc = "复习\n\n复习";
    expect(findBlockByAnchor(doc, "复习").ok).toBe(false);
  });
  it("rejects zero matches", () => {
    expect(findBlockByAnchor("a\n\nb", "z").ok).toBe(false);
  });
});
