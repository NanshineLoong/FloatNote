// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { handleBackspace, handleOutdent, handleTab } from "./list-keymap";

function mount(doc: string, anchor: number, head = anchor): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor, head } }),
  });
}

describe("list keymap indentation", () => {
  it("indents the current list item with its descendants", () => {
    const doc = "- previous\n- parent\n    - child\n- next";
    const view = mount(doc, doc.indexOf("parent"));
    expect(handleTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(
      "- previous\n    - parent\n        - child\n- next",
    );
    view.destroy();
  });

  it("renumbers ordered-list source after indenting an item into a child list", () => {
    const doc = "1. first\n2. second\n3. child\n4. tail";
    const view = mount(doc, doc.indexOf("child"));

    expect(handleTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. first\n2. second\n    1. child\n3. tail");
    expect(view.state.doc.lineAt(view.state.selection.main.head).text).toContain("child");
    view.destroy();
  });

  it("indents every line in a prose selection", () => {
    const view = mount("alpha\nbeta", 0, "alpha\nbeta".length);
    expect(handleTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("    alpha\n    beta");
    view.destroy();
  });

  it("indents a blank prose line so Tab stays in the editor", () => {
    const view = mount("", 0);

    expect(handleTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("    ");
    view.destroy();
  });

  it("outdents a selected nested list subtree together", () => {
    const doc = "    - parent\n        - child\n- next";
    const view = mount(doc, doc.indexOf("parent"));
    expect(handleOutdent(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("- parent\n    - child\n- next");
    view.destroy();
  });

  it("renumbers ordered-list source after Backspace outdents an item", () => {
    const doc = "1. first\n2. second\n    1. child\n3. tail";
    const childStart = doc.indexOf("    1. child");
    const view = mount(doc, childStart);

    expect(handleBackspace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("1. first\n2. second\n3. child\n4. tail");
    view.destroy();
  });
});
