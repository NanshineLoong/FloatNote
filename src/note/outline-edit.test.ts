import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  buildDedentChange,
  buildEnterChange,
  buildIndentChange,
  buildMergeBackChange,
  buildMoveSubtreeChange,
  type OutlineEdit,
} from "./outline-edit";

function applyEdit(doc: string, edit: OutlineEdit | null): { doc: string; anchor: number } {
  expect(edit).not.toBeNull();
  const state = EditorState.create({ doc });
  const next = state.update({
    changes: edit!.changes,
    selection: edit!.selection,
  }).state;
  return { doc: next.doc.toString(), anchor: next.selection.main.anchor };
}

describe("outline edit builders", () => {
  it("creates a same-level heading on Enter at heading end", () => {
    const doc = "## Heading";
    const next = applyEdit(doc, buildEnterChange(doc, doc.length));

    expect(next.doc).toBe("## Heading\n## ");
    expect(next.anchor).toBe(next.doc.length);
  });

  it("ignores hidden paragraph content", () => {
    const doc = "Paragraph";
    expect(buildIndentChange(doc, 4)).toBeNull();
  });

  it("does not turn a top-level outline list item into hidden paragraph text", () => {
    const doc = "## Heading\n- item";
    expect(buildDedentChange(doc, doc.length)?.swallow).toBe(true);
  });

  it("merges a non-empty node into its previous same-level sibling at line start", () => {
    const doc = "- first\n- second";
    const secondLineStart = doc.indexOf("- second");
    const next = applyEdit(doc, buildMergeBackChange(doc, secondLineStart));

    expect(next.doc).toBe("- first second");
    expect(next.anchor).toBe("- first".length);
  });

  it("moves a subtree down over the next sibling subtree", () => {
    const doc = "# A\n- one\n  - child\n- two\n";
    const pos = doc.indexOf("one");
    const next = applyEdit(doc, buildMoveSubtreeChange(doc, pos, "down"));

    expect(next.doc).toBe("# A\n- two\n- one\n  - child\n");
    expect(next.anchor).toBe(next.doc.indexOf("one"));
  });

  it("splits a list item on mid-line Enter (mubu)", () => {
    const doc = "- item";
    const pos = doc.indexOf("i"); // 光标在 item 的 i 前
    const next = applyEdit(doc, buildEnterChange(doc, pos));

    expect(next.doc).toBe("- \n- item");
    expect(next.anchor).toBe(next.doc.indexOf("item"));
  });

  it("creates a same-level list bullet on Enter at line end", () => {
    const doc = "- one";
    const next = applyEdit(doc, buildEnterChange(doc, doc.length));

    expect(next.doc).toBe("- one\n- ");
    expect(next.anchor).toBe(next.doc.length);
  });

  it("exits the list when Enter is pressed on an empty bullet", () => {
    const doc = "- ";
    const next = applyEdit(doc, buildEnterChange(doc, doc.length));

    expect(next.doc).toBe("");
  });

  it("falls through on hidden paragraph Enter", () => {
    const doc = "para";
    expect(buildEnterChange(doc, doc.length)).toBeNull();
  });

  it("falls through on mid-para Enter (returns null)", () => {
    const doc = "para";
    expect(buildEnterChange(doc, 2)).toBeNull();
  });

  it("falls through on hidden code blocks", () => {
    const doc = "```ts\nconst x = 1;\n```";
    expect(buildIndentChange(doc, 0)).toBeNull();
  });

  it("swallows Backspace at line start when there is no previous same-level sibling", () => {
    const doc = "- lone";
    const edit = buildMergeBackChange(doc, 0);
    expect(edit?.swallow).toBe(true);
  });

  it("dedents a list item by two spaces on Shift+Tab", () => {
    const doc = "- parent\n  - child";
    const childPos = doc.indexOf("- child");
    const next = applyEdit(doc, buildDedentChange(doc, childPos + 2));

    expect(next.doc).toBe("- parent\n- child");
  });
});
