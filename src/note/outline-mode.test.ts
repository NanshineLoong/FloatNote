import { EditorState } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
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

  it("hides every non-heading/non-list source line", () => {
    const doc = "# A\nparagraph\n![cap](img.png)\n```md\n- code text\n```\n- visible";
    const state = EditorState.create({ doc, extensions: [outlineMode({ initialOn: true })] });
    const outline = getOutlineState(state);
    const hiddenLines: number[] = [];
    const cursor = outline.decorations.iter();
    while (cursor.value) {
      const cls = (cursor.value as Decoration).spec.class as string | undefined;
      if (cls?.includes("cm-outline-hidden")) hiddenLines.push(state.doc.lineAt(cursor.from).number);
      cursor.next();
    }
    expect(hiddenLines).toEqual([2, 3, 4, 5, 6]);
    expect(outline.nodes.map((node) => node.text)).toEqual(["A", "visible"]);
  });

  it("hides all lines in a document with no structural outline nodes", () => {
    const state = EditorState.create({
      doc: "paragraph\n![cap](img.png)",
      extensions: [outlineMode({ initialOn: true })],
    });
    const outline = getOutlineState(state);
    const hidden: number[] = [];
    const cursor = outline.decorations.iter();
    while (cursor.value) {
      const cls = (cursor.value as Decoration).spec.class as string | undefined;
      if (cls?.includes("cm-outline-hidden")) hidden.push(state.doc.lineAt(cursor.from).number);
      cursor.next();
    }
    expect(outline.nodes).toEqual([]);
    expect(hidden).toEqual([1, 2]);
  });
});
