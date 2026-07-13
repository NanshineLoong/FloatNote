import { describe, expect, it } from "vitest";
import { EditorState, Transaction } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { iconCacheStateKey, livePreview, previewField, rangeTouchesSelection, shouldMapPreviewDecorations, shouldRetryMissingIcon } from "./preview";
import type { Decoration, DecorationSet } from "@codemirror/view";

function decorations(set: DecorationSet): Array<{ from: number; to: number; spec: any }> {
  const out: Array<{ from: number; to: number; spec: any }> = [];
  const cur = set.iter();
  while (cur.value) {
    out.push({ from: cur.from, to: cur.to, spec: (cur.value as Decoration).spec });
    cur.next();
  }
  return out;
}

describe("quote icon retry", () => {
  it("retries a missing app icon after the retry window", () => {
    expect(shouldRetryMissingIcon(1_000, 10_000, 30_000)).toBe(false);
    expect(shouldRetryMissingIcon(1_000, 31_000, 30_000)).toBe(true);
  });

  it("retries when a null icon cache has no failure timestamp", () => {
    expect(shouldRetryMissingIcon(undefined, 10_000)).toBe(true);
  });

  it("uses a different widget key for empty, missing, and ready icons", () => {
    expect(iconCacheStateKey(false, undefined, undefined)).toBe("empty");
    expect(iconCacheStateKey(true, null, 1_000)).toBe("missing:1000");
    expect(iconCacheStateKey(true, "data:image/png;base64,x", undefined)).toBe("ready");
  });
});

describe("rangeTouchesSelection", () => {
  const sel = (from: number, to = from) => [{ from, to }];

  it("touches when a bare cursor sits inside the mark", () => {
    // mark [2,5), cursor at 3
    expect(rangeTouchesSelection(sel(3), 2, 5)).toBe(true);
  });

  it("touches when a bare cursor sits at either edge of the mark", () => {
    expect(rangeTouchesSelection(sel(2), 2, 5)).toBe(true); // left edge
    expect(rangeTouchesSelection(sel(5), 2, 5)).toBe(true); // right edge
  });

  it("does not touch when the cursor is outside the mark", () => {
    expect(rangeTouchesSelection(sel(0), 2, 5)).toBe(false);
    expect(rangeTouchesSelection(sel(9), 2, 5)).toBe(false);
  });

  it("touches when a selection range overlaps the mark", () => {
    // selection [4,8) overlaps mark [2,5)
    expect(rangeTouchesSelection([{ from: 4, to: 8 }], 2, 5)).toBe(true);
  });

  it("does not touch when a selection range is disjoint", () => {
    expect(rangeTouchesSelection([{ from: 5, to: 8 }], 2, 5)).toBe(false);
    expect(rangeTouchesSelection([{ from: 0, to: 2 }], 2, 5)).toBe(false);
  });

  it("checks all ranges in a multi-range selection", () => {
    expect(rangeTouchesSelection([sel(0)[0], sel(9)[0]], 2, 5)).toBe(false);
    expect(rangeTouchesSelection([sel(0)[0], sel(4)[0]], 2, 5)).toBe(true);
  });
});

describe("IME composition preview updates", () => {
  it("maps current decorations during an unconfirmed composition update", () => {
    const state = EditorState.create({ doc: "# 标题", extensions: [markdown(), ...livePreview()] });
    const transaction = state.update({
      changes: { from: state.doc.length, insert: "中" },
      annotations: Transaction.userEvent.of("input.type.compose"),
    });

    expect(shouldMapPreviewDecorations(transaction)).toBe(true);
  });

  it("rebuilds decorations for ordinary input once composition is confirmed", () => {
    const state = EditorState.create({ doc: "# 标题", extensions: [markdown(), ...livePreview()] });
    const transaction = state.update({ changes: { from: state.doc.length, insert: "中" } });

    expect(shouldMapPreviewDecorations(transaction)).toBe(false);
  });
});

describe("nested list preview", () => {
  it("keeps every list level's bullet when a deeper child is added", () => {
    const doc = "- root\n  - middle\n    - leaf";
    const state = EditorState.create({
      doc,
      extensions: [markdown(), ...livePreview()],
      selection: { anchor: doc.length },
    });
    const widgetStarts = decorations(state.field(previewField))
      .filter((d) => d.spec.widget)
      .map((d) => d.from);

    expect(widgetStarts).toEqual([0, doc.indexOf("- middle"), doc.indexOf("- leaf")]);
  });
});
