import { describe, expect, it } from "vitest";
import { buildDiffRows, foldDiffRows } from "./permission-diff";

describe("buildDiffRows", () => {
  it("aligns an insertion without marking following lines as changed", () => {
    expect(buildDiffRows("a\nb\nc", "a\ninserted\nb\nc")).toEqual([
      { kind: "unchanged", oldText: "a", newText: "a" },
      { kind: "added", oldText: "", newText: "inserted" },
      { kind: "unchanged", oldText: "b", newText: "b" },
      { kind: "unchanged", oldText: "c", newText: "c" },
    ]);
  });

  it("pairs unequal replacement groups and keeps blank cells", () => {
    expect(buildDiffRows("a\nb\nc\nd", "a\nx\nd")).toEqual([
      { kind: "unchanged", oldText: "a", newText: "a" },
      { kind: "replaced", oldText: "b", newText: "x" },
      { kind: "removed", oldText: "c", newText: "" },
      { kind: "unchanged", oldText: "d", newText: "d" },
    ]);
  });

  it("represents empty additions and deletions", () => {
    expect(buildDiffRows("", "new")).toEqual([{ kind: "added", oldText: "", newText: "new" }]);
    expect(buildDiffRows("old", "")).toEqual([{ kind: "removed", oldText: "old", newText: "" }]);
  });

  it("aligns repeated lines around a deletion", () => {
    expect(buildDiffRows("same\nremove\nsame\nend", "same\nsame\nend")).toEqual([
      { kind: "unchanged", oldText: "same", newText: "same" },
      { kind: "removed", oldText: "remove", newText: "" },
      { kind: "unchanged", oldText: "same", newText: "same" },
      { kind: "unchanged", oldText: "end", newText: "end" },
    ]);
  });
});

describe("foldDiffRows", () => {
  it("keeps context and folds only the long unchanged center", () => {
    const rows = buildDiffRows(
      ["0", "1", "2", "3", "4", "5", "6", "old", "8", "9"].join("\n"),
      ["0", "1", "2", "3", "4", "5", "6", "new", "8", "9"].join("\n"),
    );
    const folded = foldDiffRows(rows, 2);
    const collapsed = folded.find((row) => row.kind === "collapsed");
    expect(collapsed?.kind === "collapsed" ? collapsed.rows.map((row) => row.oldText) : []).toEqual(["0", "1", "2", "3", "4"]);
    expect(folded.some((row) => row.kind === "replaced")).toBe(true);
  });
});
