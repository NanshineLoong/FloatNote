import { describe, expect, it } from "vitest";
import { blockRanges } from "@floatnote/note-logic";
import { pieceDropPos, pickMode } from "./drag";

/** Minimal stand-in for a DOMRect — `pickMode` only reads left/right/top/bottom. */
function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return { left, top, right, bottom, x: left, y: top, width: right - left, height: bottom - top, toJSON: () => ({}) } as DOMRect;
}

describe("pickMode", () => {
  const textCol = rect(0, 0, 400, 600);
  const pieceCol = rect(424, 0, 824, 600); // 24px gap between

  it("always reorders when split is off", () => {
    expect(pickMode(500, 100, textCol, pieceCol, false, true, "cross")).toBe("reorder");
  });

  it("always reorders when there is no piece editor", () => {
    expect(pickMode(500, 100, textCol, pieceCol, true, false, "cross")).toBe("reorder");
  });

  it("switches to cross when pointer enters the piece column", () => {
    expect(pickMode(600, 100, textCol, pieceCol, true, true, "reorder")).toBe("cross");
  });

  it("stays in reorder while the pointer is in the inbox column", () => {
    expect(pickMode(200, 100, textCol, pieceCol, true, true, "reorder")).toBe("reorder");
  });

  it("keeps the last mode when the pointer is in the gap between columns", () => {
    expect(pickMode(412, 100, textCol, pieceCol, true, true, "cross")).toBe("cross");
    expect(pickMode(412, 100, textCol, pieceCol, true, true, "reorder")).toBe("reorder");
  });

  it("keeps the last mode when the pointer is outside both columns", () => {
    expect(pickMode(900, 100, textCol, pieceCol, true, true, "cross")).toBe("cross");
    expect(pickMode(900, 100, textCol, pieceCol, true, true, "reorder")).toBe("reorder");
  });
});

describe("pieceDropPos", () => {
  it("inserts at doc end when dropping past the last block", () => {
    const text = "para one\n\npara two";
    const ranges = blockRanges(text);
    expect(pieceDropPos(ranges, ranges.length, text.length)).toBe(text.length);
  });

  it("inserts before the first block when dropping at index 0", () => {
    const text = "para one\n\npara two";
    const ranges = blockRanges(text);
    expect(pieceDropPos(ranges, 0, text.length)).toBe(ranges[0].from);
    expect(pieceDropPos(ranges, 0, text.length)).toBe(0);
  });

  it("inserts before the second block when dropping at index 1", () => {
    const text = "para one\n\npara two";
    const ranges = blockRanges(text);
    expect(pieceDropPos(ranges, 1, text.length)).toBe(ranges[1].from);
  });

  it("falls back to doc length for an empty document", () => {
    const ranges = blockRanges("");
    expect(pieceDropPos(ranges, 0, 0)).toBe(0);
  });
});
