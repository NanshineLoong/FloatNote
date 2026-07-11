import { describe, expect, it } from "vitest";
import { blockRanges, moveBlockChanges, removeBlockChanges } from "./ranges";

/** Apply a CodeMirror-style change list to plain text (left-to-right, original
 * coordinates) so we can assert on the resulting document. */
function apply(text: string, changes: { from: number; to: number; insert: string }[]): string {
  const sorted = [...changes].sort((a, b) => a.from - b.from);
  let out = "";
  let cursor = 0;
  for (const c of sorted) {
    out += text.slice(cursor, c.from) + c.insert;
    cursor = c.to;
  }
  return out + text.slice(cursor);
}

describe("blockRanges", () => {
  it("splits blank-line-separated paragraphs", () => {
    const text = "first block\nstill first\n\nsecond block";
    const ranges = blockRanges(text);
    expect(ranges).toHaveLength(2);
    expect(text.slice(ranges[0].from, ranges[0].to)).toBe("first block\nstill first");
    expect(text.slice(ranges[1].from, ranges[1].to)).toBe("second block");
  });

  it("treats each todo as its own block", () => {
    const text = "- [ ] a\n- [x] b";
    const ranges = blockRanges(text);
    expect(ranges).toHaveLength(2);
    expect(text.slice(ranges[0].from, ranges[0].to)).toBe("- [ ] a");
    expect(text.slice(ranges[1].from, ranges[1].to)).toBe("- [x] b");
  });

  it("groups a multi-line callout/quote into one block", () => {
    const text = "> [!quote] Title\n> body line";
    const ranges = blockRanges(text);
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].from, ranges[0].to)).toBe(text);
  });

  it("ignores leading and inter-block blank lines for offsets", () => {
    const text = "\n\nalpha\n\n\nbeta";
    const ranges = blockRanges(text);
    expect(ranges.map((r) => text.slice(r.from, r.to))).toEqual(["alpha", "beta"]);
  });

  it("skips the line-1 floatnote defs comment (no handle, not a block)", () => {
    const text = '<!-- floatnote-tags: concept="概念"|c=#e5484d -->\nalpha\n\nbeta';
    const ranges = blockRanges(text);
    expect(ranges.map((r) => text.slice(r.from, r.to))).toEqual(["alpha", "beta"]);
  });

  it("a trailing floatnote marker stays inside its block (r.to past the marker)", () => {
    const text = "alpha<!-- floatnote:tag=concept -->\n\nbeta";
    const ranges = blockRanges(text);
    expect(ranges).toHaveLength(2);
    expect(text.slice(ranges[0].from, ranges[0].to)).toBe(
      "alpha<!-- floatnote:tag=concept -->",
    );
    expect(text.slice(ranges[1].from, ranges[1].to)).toBe("beta");
  });

  it("a tagged callout stays one block with its trailing marker", () => {
    const text = "> [!quote] chip\n> body<!-- floatnote:tag=concept -->";
    const ranges = blockRanges(text);
    expect(ranges).toHaveLength(1);
    expect(text.slice(ranges[0].from, ranges[0].to)).toBe(text);
  });

  it("keeps a standalone image separate from adjacent prose without blank lines", () => {
    const text = "above\n![cap](img.png){width=240 align=center}<!-- floatnote:tag=visual -->\nbelow";
    expect(blockRanges(text).map((r) => text.slice(r.from, r.to))).toEqual([
      "above",
      "![cap](img.png){width=240 align=center}<!-- floatnote:tag=visual -->",
      "below",
    ]);
  });

  it("keeps a fenced code block separate from adjacent prose", () => {
    const text = "above\n```md\n![not-an-image](inside-code.png)\n```\nbelow";
    expect(blockRanges(text).map((r) => text.slice(r.from, r.to))).toEqual([
      "above",
      "```md\n![not-an-image](inside-code.png)\n```",
      "below",
    ]);
  });

  it("keeps headings and GFM tables as distinct canonical blocks", () => {
    const text = "# Heading\nparagraph\n| A | B |\n| - | - |\n| 1 | 2 |\nafter";
    expect(blockRanges(text).map((r) => text.slice(r.from, r.to))).toEqual([
      "# Heading",
      "paragraph",
      "| A | B |\n| - | - |\n| 1 | 2 |",
      "after",
    ]);
  });
});

describe("moveBlockChanges", () => {
  const text = "A\n\nB\n\nC";
  const ranges = blockRanges(text);

  it("is a no-op when dropping in place", () => {
    expect(moveBlockChanges(text, ranges, 0, 0)).toEqual([]);
    expect(moveBlockChanges(text, ranges, 0, 1)).toEqual([]);
  });

  it("moves a middle block to the front", () => {
    const changes = moveBlockChanges(text, ranges, 1, 0);
    expect(apply(text, changes)).toBe("B\n\nA\n\nC");
  });

  it("moves the first block to the end", () => {
    const changes = moveBlockChanges(text, ranges, 0, 3);
    expect(apply(text, changes)).toBe("B\n\nC\n\nA");
  });

  it("moves the last block to the front", () => {
    const changes = moveBlockChanges(text, ranges, 2, 0);
    expect(apply(text, changes)).toBe("C\n\nA\n\nB");
  });
});

describe("removeBlockChanges", () => {
  const text = "A\n\nB\n\nC";
  const ranges = blockRanges(text);

  it("removes a middle block with its separator", () => {
    expect(apply(text, removeBlockChanges(ranges, 1))).toBe("A\n\nC");
  });

  it("removes the last block with its preceding separator", () => {
    expect(apply(text, removeBlockChanges(ranges, 2))).toBe("A\n\nB");
  });

  it("removes the only block", () => {
    const solo = "only";
    expect(apply(solo, removeBlockChanges(blockRanges(solo), 0))).toBe("");
  });
});
