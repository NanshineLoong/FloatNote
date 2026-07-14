import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { hardBreakLineStarts } from "./hard-break-spacing";

describe("hardBreakLineStarts", () => {
  it("returns only lines that follow an explicit line break", () => {
    const state = EditorState.create({ doc: "first\nsecond\nthird" });

    expect(hardBreakLineStarts(state.doc)).toEqual([6, 13]);
  });

  it("does not create spacing after the final trailing line break", () => {
    const state = EditorState.create({ doc: "first\n" });

    expect(hardBreakLineStarts(state.doc)).toEqual([]);
  });
});
