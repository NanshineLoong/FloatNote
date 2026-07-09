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

  it("turns a paragraph into a list item on first Tab", () => {
    const doc = "Paragraph";
    const next = applyEdit(doc, buildIndentChange(doc, 4));

    expect(next.doc).toBe("- Paragraph");
    expect(next.anchor).toBe(6);
  });

  it("turns a body-level list item back into a paragraph on Shift+Tab", () => {
    const doc = "## Heading\n- item";
    const next = applyEdit(doc, buildDedentChange(doc, doc.length));

    expect(next.doc).toBe("## Heading\nitem");
    expect(next.anchor).toBe(next.doc.length);
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

  it("creates a sibling para on Enter at para end", () => {
    const doc = "para";
    const next = applyEdit(doc, buildEnterChange(doc, doc.length));

    expect(next.doc).toBe("para\n\n");
    expect(next.anchor).toBe(next.doc.length);
  });

  it("falls through on mid-para Enter (returns null)", () => {
    const doc = "para";
    expect(buildEnterChange(doc, 2)).toBeNull();
  });

  it("swallows Tab on a card to avoid corrupting the code block", () => {
    const doc = "```ts\nconst x = 1;\n```";
    const edit = buildIndentChange(doc, 0);
    expect(edit?.swallow).toBe(true);
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
