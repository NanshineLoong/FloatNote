import { describe, expect, it } from "vitest";
import { parseOutline } from "./outline-tree";

describe("parseOutline", () => {
  it("projects only headings and ordered/unordered lists", () => {
    const doc = [
      "# Title",
      "",
      "Intro line",
      "wrapped",
      "",
      "- item",
      "  - child",
      "1. ordered",
      "",
      "```ts",
      "const x = 1;",
      "```",
      "",
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "> [!quote] Source",
      "> quote body",
      "",
      "![Alt](img.png)",
      "",
      "---",
      "",
      "## Next",
      "",
      "# Other",
    ].join("\n");

    const nodes = parseOutline(doc);

    expect(nodes.map((node) => [node.kind, node.depth, node.text])).toEqual([
      ["heading", 1, "Title"],
      ["list", 2, "item"],
      ["list", 3, "child"],
      ["list", 2, "ordered"],
      ["heading", 2, "Next"],
      ["heading", 1, "Other"],
    ]);

    const title = nodes[0];
    expect(doc.slice(title.childFrom, title.childTo)).toContain("Intro line");
    expect(doc.slice(title.childFrom, title.childTo)).toContain("## Next");
    expect(doc.slice(title.childFrom, title.childTo)).not.toContain("# Other");
  });

  it("records source line spans for visible structural nodes", () => {
    const doc = [
      "# Title",
      "",
      "Intro line",
      "wrapped",
      "",
      "```ts",
      "const x = 1;",
      "```",
    ].join("\n");

    const nodes = parseOutline(doc);
    const heading = nodes.find((n) => n.kind === "heading")!;
    expect([heading.lineFrom, heading.lineTo]).toEqual([1, 1]);
    expect(nodes).toHaveLength(1);
  });

  it("keeps repeated sibling text distinct with occurrence-aware ids", () => {
    const nodes = parseOutline("- TODO\n- TODO\n  - TODO\n- TODO");

    expect(nodes.map((node) => node.siblingOrdinal)).toEqual([0, 1, 0, 2]);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
  });

  it("maps 4-space indentation to exactly one outline level", () => {
    const nodes = parseOutline("- parent\n    - child\n        - grandchild\n\t- tab-child");
    expect(nodes.map((node) => node.depth)).toEqual([1, 2, 3, 2]);
  });
});
