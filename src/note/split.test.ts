import { describe, it, expect } from "vitest";
import { canSplit, computeSplitLayout, SPLIT_PREFS } from "./split";

describe("canSplit", () => {
  it("is false below the two-pane minimum width", () => {
    const min = 2 * SPLIT_PREFS.pad + 2 * SPLIT_PREFS.paneMin + SPLIT_PREFS.gap;
    expect(canSplit(min - 1)).toBe(false);
    expect(canSplit(min)).toBe(true);
  });
});

describe("computeSplitLayout", () => {
  it("splits the inner width into two equal panes with pad margins and a gap", () => {
    const layout = computeSplitLayout(2 * SPLIT_PREFS.pad + 2 * SPLIT_PREFS.paneMin + SPLIT_PREFS.gap);
    expect(layout.leftMargin).toBe(SPLIT_PREFS.pad);
    expect(layout.rightMargin).toBe(SPLIT_PREFS.pad);
    expect(layout.inboxWidth).toBe(SPLIT_PREFS.paneMin);
    expect(layout.pieceWidth).toBe(SPLIT_PREFS.paneMin);
    expect(layout.gap).toBe(SPLIT_PREFS.gap);
  });

  it("clamps panes at paneMax and spills the extra into the margins", () => {
    const wide = 2 * SPLIT_PREFS.pad + 2 * SPLIT_PREFS.paneMax + SPLIT_PREFS.gap + 400;
    const layout = computeSplitLayout(wide);
    expect(layout.inboxWidth).toBe(SPLIT_PREFS.paneMax);
    expect(layout.pieceWidth).toBe(SPLIT_PREFS.paneMax);
    // 200 of spill on each side, on top of the base pad.
    expect(layout.leftMargin).toBe(SPLIT_PREFS.pad + 200);
    expect(layout.rightMargin).toBe(SPLIT_PREFS.pad + 200);
  });

  it("grows panes evenly between min and max", () => {
    const width = 2 * SPLIT_PREFS.pad + 2 * SPLIT_PREFS.paneMin + SPLIT_PREFS.gap + 200;
    const layout = computeSplitLayout(width);
    expect(layout.inboxWidth).toBe(SPLIT_PREFS.paneMin + 100);
    expect(layout.pieceWidth).toBe(SPLIT_PREFS.paneMin + 100);
    expect(layout.leftMargin).toBe(SPLIT_PREFS.pad);
  });
});
