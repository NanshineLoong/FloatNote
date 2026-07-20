// @vitest-environment jsdom
import { EditorState, StateField, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { handleBackspace, handleOutdent, handleTab } from "./list-keymap";

function mount(doc: string, anchor: number, head = anchor, extensions: Extension[] = []): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor, head }, extensions }),
  });
}

describe("list keymap indentation", () => {
  it("updates configured state fields only once per indentation command", () => {
    let docUpdates = 0;
    const updateCounter = StateField.define<null>({
      create: () => null,
      update(value, transaction) {
        if (transaction.docChanged) docUpdates += 1;
        return value;
      },
    });
    const doc = "- previous\n- item";
    const view = mount(doc, doc.indexOf("item"), undefined, [updateCounter]);

    expect(handleTab(view)).toBe(true);
    expect(docUpdates).toBe(1);
    view.destroy();
  });

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
    expect(view.state.selection.main).toMatchObject({ anchor: 4, head: 4 });
    view.destroy();
  });

  it("keeps the caret after indentation on a prose line", () => {
    const view = mount("text", 0);

    expect(handleTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("    text");
    expect(view.state.selection.main).toMatchObject({ anchor: 4, head: 4 });
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
