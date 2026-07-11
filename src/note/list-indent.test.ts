import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import {
  canDemote,
  isListItemLine,
  lineDepth,
  olOrdinal,
  outdentLine,
  prevListItemDepth,
  listSubtreeEnd,
  transformIndentRange,
  leadingColumns,
} from "./list-indent";

describe("isListItemLine", () => {
  it("matches unordered and ordered markers", () => {
    expect(isListItemLine("- a")).toBe(true);
    expect(isListItemLine("* a")).toBe(true);
    expect(isListItemLine("+ a")).toBe(true);
    expect(isListItemLine("1. a")).toBe(true);
    expect(isListItemLine("  - a")).toBe(true);
  });
  it("rejects plain and empty lines", () => {
    expect(isListItemLine("plain")).toBe(false);
    expect(isListItemLine("")).toBe(false);
    expect(isListItemLine("    ")).toBe(false);
  });
});

describe("lineDepth", () => {
  it("counts 4 spaces per level", () => {
    expect(lineDepth("- a")).toBe(0);
    expect(lineDepth("    - a")).toBe(1);
    expect(lineDepth("        - a")).toBe(2);
  });
  it("floors sub-level indent", () => {
    expect(lineDepth("  - a")).toBe(0);
  });
});

describe("outdentLine", () => {
  it("outdent removes up to 4 leading spaces", () => {
    expect(outdentLine("    - a")).toBe("- a");
    expect(outdentLine("        - a")).toBe("    - a");
  });
  it("outdent removes a tab too", () => {
    expect(outdentLine("\t- a")).toBe("- a");
  });
  it("outdent on no leading whitespace is a no-op", () => {
    expect(outdentLine("- a")).toBe("- a");
  });
  it("outdent removes only what is there", () => {
    expect(outdentLine("  - a")).toBe("- a");
  });
});

describe("canDemote", () => {
  it("allows when current is at or above previous", () => {
    expect(canDemote(0, 0)).toBe(true);
    expect(canDemote(1, 1)).toBe(true);
    expect(canDemote(2, 1)).toBe(true);
  });
  it("forbids when already one level below previous", () => {
    expect(canDemote(0, 1)).toBe(false);
    expect(canDemote(1, 2)).toBe(false);
  });
  it("forbids the first item (no previous)", () => {
    expect(canDemote(null, 0)).toBe(false);
  });
});

describe("prevListItemDepth", () => {
  const lines = ["- a", "    - b", "- c", "", "- d"];
  it("returns the previous list line's depth", () => {
    expect(prevListItemDepth(lines, 1)).toBe(0); // prev "- a" depth 0
    expect(prevListItemDepth(lines, 2)).toBe(1); // prev "    - b" depth 1
  });
  it("skips a blank line", () => {
    expect(prevListItemDepth(lines, 4)).toBe(0); // prev (skip blank) "- c" depth 0
  });
  it("returns null when a non-list non-blank line blocks", () => {
    expect(prevListItemDepth(["plain", "- a"], 1)).toBe(null);
  });
  it("returns null at the top", () => {
    expect(prevListItemDepth(["- a"], 0)).toBe(null);
  });
});

describe("structural list indentation", () => {
  const lines = ["- parent", "    - child", "        - grandchild", "- sibling"];

  it("finds the full descendant subtree", () => {
    expect(listSubtreeEnd(lines, 0)).toBe(2);
    expect(listSubtreeEnd(lines, 1)).toBe(2);
    expect(listSubtreeEnd(lines, 3)).toBe(3);
  });

  it("keeps indented continuation text and fenced content with the item", () => {
    const continued = [
      "- parent",
      "    continuation",
      "    ```js",
      "    code()",
      "    ```",
      "    - child",
      "- sibling",
    ];
    expect(listSubtreeEnd(continued, 0)).toBe(5);
  });

  it("indents a list item and every descendant together", () => {
    expect(transformIndentRange(lines, 0, 0, "indent")).toEqual([
      "    - parent",
      "        - child",
      "            - grandchild",
      "- sibling",
    ]);
  });

  it("outdents selected prose lines consistently", () => {
    expect(transformIndentRange(["    alpha", "      beta", "gamma"], 0, 1, "outdent"))
      .toEqual(["alpha", "  beta", "gamma"]);
  });

  it("measures tab stops and normalizes only affected prefixes", () => {
    expect(leadingColumns(" \t- item")).toBe(4);
    expect(transformIndentRange(["\t- item", " \t  continuation"], 0, 1, "indent"))
      .toEqual(["        - item", "          continuation"]);
    expect(outdentLine("\t  - item")).toBe("  - item");
  });
});

/** Ordered-list ListMark ordinals in document order, computed by walking the
 *  markdown syntax tree (same as preview.ts does). Mirrors the editor's live
 *  preview so the test exercises the real grammar. */
function ordinals(doc: string): number[] {
  const s = EditorState.create({ doc, extensions: [markdown()] });
  const out: number[] = [];
  syntaxTree(s).iterate({
    enter(node) {
      if (node.name !== "ListMark") return;
      const text = s.doc.sliceString(node.from, node.to);
      if (!/\d/.test(text)) return; // skip unordered markers
      if (node.node.parent?.name !== "ListItem") return;
      out.push(olOrdinal(node.node));
    },
  });
  return out;
}

describe("olOrdinal", () => {
  it("numbers a single ordered list 1..n", () => {
    expect(ordinals("1. a\n2. b\n3. c")).toEqual([1, 2, 3]);
  });
  it("restarts at 1 in each nested sublist", () => {
    // outer 1, inner 1, inner 2, outer 2
    expect(ordinals("1. a\n    1. b\n    2. c\n2. d")).toEqual([1, 1, 2, 2]);
  });
  it("resets across a list boundary / non-list line", () => {
    expect(ordinals("1. a\n2. b\n\nplain\n\n3. c")).toEqual([1, 2, 1]);
  });
  it("ignores the literal source digits — ordinal is tree-derived", () => {
    expect(ordinals("9. a\n1. b")).toEqual([1, 2]);
  });
});
