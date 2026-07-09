import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  getOutlineState,
  OutlineFoldEffect,
  OutlineToggleEffect,
  outlineMode,
} from "./outline-mode";

describe("outline mode state", () => {
  it("starts off by default and creates no layout decorations", () => {
    const state = EditorState.create({ doc: "# A\n- one", extensions: [outlineMode()] });
    const outline = getOutlineState(state);

    expect(outline.on).toBe(false);
    expect(outline.decorations.size).toBe(0);
  });

  it("toggles on and clears folded nodes when toggled off", () => {
    let state = EditorState.create({ doc: "# A\n- one", extensions: [outlineMode()] });
    state = state.update({ effects: OutlineToggleEffect.of(true) }).state;
    const id = getOutlineState(state).nodes[0].id;

    state = state.update({ effects: OutlineFoldEffect.of({ id, folded: true }) }).state;
    expect(getOutlineState(state).folded.has(id)).toBe(true);

    state = state.update({ effects: OutlineToggleEffect.of(false) }).state;
    const outline = getOutlineState(state);
    expect(outline.on).toBe(false);
    expect(outline.folded.size).toBe(0);
    expect(outline.decorations.size).toBe(0);
  });

  it("keeps folded state across ordinary edits by fallback node identity", () => {
    let state = EditorState.create({
      doc: "# A\n- one\n- two",
      extensions: [outlineMode({ initialOn: true })],
    });
    const one = getOutlineState(state).nodes.find((node) => node.text === "one")!;

    state = state.update({ effects: OutlineFoldEffect.of({ id: one.id, folded: true }) }).state;
    state = state.update({ changes: { from: 0, insert: "Preface\n\n" } }).state;

    const moved = getOutlineState(state).nodes.find((node) => node.text === "one")!;
    expect(getOutlineState(state).folded.has(moved.id)).toBe(true);
  });
});
