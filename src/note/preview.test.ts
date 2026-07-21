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

describe("math preview", () => {
  it("replaces complete inline and display formulas when the selection is elsewhere", () => {
    const doc = "Before $E=mc^2$ after\n\n$$\n\\sum_{i=1}^n i\n$$";
    const state = EditorState.create({
      doc,
      extensions: [markdown(), ...livePreview()],
      selection: { anchor: 0 },
    });
    const widgets = decorations(state.field(previewField))
      .filter((decoration) => decoration.spec.widget)
      .map((decoration) => ({
        from: decoration.from,
        to: decoration.to,
        block: decoration.spec.block === true,
        name: decoration.spec.widget.constructor.name,
      }));

    expect(widgets).toEqual([
      { from: doc.indexOf("$E=mc^2$"), to: doc.indexOf("$E=mc^2$") + 8, block: false, name: "MathWidget" },
      { from: doc.indexOf("$$"), to: doc.length, block: true, name: "MathWidget" },
    ]);
  });

  it("keeps formulas as source while selected and ignores code, escaped dollars, and currency", () => {
    const doc = [
      "Selected $x^2$ here",
      "`$inline_code$`",
      "```tex",
      "$fenced_code$",
      "```",
      "Cost \\$5 or $5 and $10",
    ].join("\n");
    const selectedFormula = doc.indexOf("$x^2$");
    const state = EditorState.create({
      doc,
      extensions: [markdown(), ...livePreview()],
      selection: { anchor: selectedFormula + 2 },
    });

    expect(decorations(state.field(previewField))
      .filter((decoration) => decoration.spec.widget?.constructor.name === "MathWidget"))
      .toEqual([]);
  });

  it("leaves an incomplete streamed formula visible as source", () => {
    const doc = "Working on $E=mc";
    const state = EditorState.create({ doc, extensions: [markdown(), ...livePreview()] });

    expect(decorations(state.field(previewField))
      .some((decoration) => decoration.spec.widget?.constructor.name === "MathWidget"))
      .toBe(false);
  });
});
