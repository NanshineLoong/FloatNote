import { describe, expect, it } from "vitest";
import { parseOutline } from "./outline-tree";

describe("parseOutline", () => {
  it("maps headings, paragraphs, lists, and cards into outline nodes", () => {
    const doc = [
      "# Title",
      "",
      "Intro line",
      "wrapped",
      "",
      "- item",
      "  - child",
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
      ["para", 2, "Intro line wrapped"],
      ["list", 2, "item"],
      ["list", 3, "child"],
      ["code-card", 2, "代码 · ts · 3 行"],
      ["table-card", 2, "表格 · 2x2"],
      ["quote-card", 2, "引用 · Source"],
      ["image-card", 2, "Alt"],
      ["hr-card", 2, "分隔线"],
      ["heading", 2, "Next"],
      ["heading", 1, "Other"],
    ]);

    const title = nodes[0];
    expect(doc.slice(title.childFrom, title.childTo)).toContain("Intro line");
    expect(doc.slice(title.childFrom, title.childTo)).toContain("## Next");
    expect(doc.slice(title.childFrom, title.childTo)).not.toContain("# Other");
  });

  it("records contiguous line spans per node (lineFrom/lineTo)", () => {
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
    const para = nodes.find((n) => n.kind === "para")!;
    const code = nodes.find((n) => n.kind === "code-card")!;

    expect([heading.lineFrom, heading.lineTo]).toEqual([1, 1]);
    // 多行 para 跨两行
    expect([para.lineFrom, para.lineTo]).toEqual([3, 4]);
    // 代码卡片跨三行（含围栏）
    expect([code.lineFrom, code.lineTo]).toEqual([6, 8]);
  });

  it("keeps repeated sibling text distinct with occurrence-aware ids", () => {
    const nodes = parseOutline("- TODO\n- TODO\n  - TODO\n- TODO");

    expect(nodes.map((node) => node.siblingOrdinal)).toEqual([0, 1, 0, 2]);
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length);
  });
});
