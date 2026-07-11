// @vitest-environment jsdom
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { handleFenceBacktick } from "./markdown-keymap";

function mount(doc: string, anchor = doc.length, head = anchor): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({ parent, state: EditorState.create({ doc, selection: { anchor, head } }) });
}

describe("fenced code completion", () => {
  it("completes the third backtick and puts the caret inside", () => {
    const view = mount("  ``");
    expect(handleFenceBacktick(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("  ```\n  \n  ```");
    expect(view.state.selection.main.head).toBe("  ```\n  ".length);
    view.destroy();
  });

  it("does not complete backticks in inline prose", () => {
    const view = mount("text ``");
    expect(handleFenceBacktick(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("text ``");
    view.destroy();
  });

  it("reuses an existing closing fence on the following line", () => {
    const view = mount("``\n`````", 2);
    expect(handleFenceBacktick(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("```\n\n`````");
    expect(view.state.selection.main.head).toBe(4);
    view.destroy();
  });

  it("wraps a selected block in fences", () => {
    const view = mount("const x = 1", 0, "const x = 1".length);
    expect(handleFenceBacktick(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("```\nconst x = 1\n```");
    expect(view.state.selection.main.from).toBe(4);
    expect(view.state.selection.main.to).toBe(15);
    view.destroy();
  });
});
