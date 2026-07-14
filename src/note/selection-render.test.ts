import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { selectedLineBreakPositions } from "./selection-render";

describe("selectedLineBreakPositions", () => {
  it("returns every selected logical line break, including an empty line", () => {
    const state = EditorState.create({ doc: "alpha\n\nomega" });

    expect(selectedLineBreakPositions(state.doc, [{ from: 1, to: 8 }])).toEqual([5, 6]);
  });

  it("does not add a marker when a range ends before its line break", () => {
    const state = EditorState.create({ doc: "alpha\nbeta" });

    expect(selectedLineBreakPositions(state.doc, [{ from: 1, to: 5 }])).toEqual([]);
  });

  it("does not treat the virtual final empty line as a line break", () => {
    const state = EditorState.create({ doc: "alpha\n" });

    expect(selectedLineBreakPositions(state.doc, [{ from: 0, to: state.doc.length }])).toEqual([5]);
  });
});
