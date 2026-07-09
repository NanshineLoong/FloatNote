import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { Strikethrough, Table, TaskList } from "@lezer/markdown";
import { describe, expect, it } from "vitest";
import { tableNeighbor } from "./table-keymap";

/** State with the same markdown grammar the editor uses (Table extension on). */
function state(doc: string, cursor: number) {
  return EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Table, Strikethrough, TaskList] })],
    selection: { anchor: cursor },
  });
}

const DOC = "intro\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nafter\n";
// Lines (1-based): 1 intro, 2 blank, 3 header, 4 delim, 5 row, 6 blank, 7 after.

describe("tableNeighbor", () => {
  it("detects the caret on the line immediately before the table", () => {
    // Line 2 (blank) is directly above the table's first line (3).
    const s = state(DOC, 6); // offset 6 = inside the blank line 2
    const n = tableNeighbor(s, 6);
    expect(n.side).toBe("before");
    expect(n.from).toBe(s.doc.line(3).from);
  });

  it("detects the caret on the line immediately after the table", () => {
    // Line 6 (blank) is directly below the table's last line (5).
    const blankStart = state(DOC, 0).doc.line(6).from;
    const s = state(DOC, blankStart);
    const n = tableNeighbor(s, blankStart);
    expect(n.side).toBe("after");
  });

  it("returns none when the caret is far from any table", () => {
    const s = state(DOC, 2); // line 1 "intro"
    expect(tableNeighbor(s, 2).side).toBe("none");
  });

  it("returns none when the caret is inside the table", () => {
    const headerStart = state(DOC, 0).doc.line(3).from;
    const s = state(DOC, headerStart + 1);
    expect(tableNeighbor(s, headerStart + 1).side).toBe("none");
  });

  it("returns none for a doc with no table", () => {
    const s = state("just\n\ntext\n", 2);
    expect(tableNeighbor(s, 2).side).toBe("none");
  });
});
