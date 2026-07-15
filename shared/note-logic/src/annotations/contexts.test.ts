import { describe, expect, it } from "vitest";
import { annotationProjection, eligibleSelectionRanges, markdownContexts } from "./contexts";

describe("Markdown annotation contexts", () => {
  it("splits a selection across visible contexts and excludes unsafe syntax", () => {
    const markdown = [
      "# Heading",
      "",
      "paragraph [label](https://example.com) and `code` ![alt](img.png)",
      "",
      "- list item",
      "",
      "> quote body",
      "",
      "> [!quote] App",
      "> quoted body",
      "",
      "| a | b |",
      "|---|---|",
      "| c | d |",
      "",
      "```ts",
      "const hidden = true;",
      "```",
    ].join("\n");
    const ranges = eligibleSelectionRanges(markdown, { from: 0, to: markdown.length });
    const selected = ranges.map((range) => markdown.slice(range.from, range.to));

    expect(selected).toContain("Heading");
    expect(selected).toContain("label");
    expect(selected).toContain("list item");
    expect(selected).toContain("quote body");
    expect(selected).toContain("quoted body");
    expect(selected).toEqual(expect.arrayContaining(["a", "b", "c", "d"]));
    expect(selected.join(" ")).not.toContain("https://example.com");
    expect(selected.join(" ")).not.toContain("code");
    expect(selected.join(" ")).not.toContain("alt");
    expect(selected.join(" ")).not.toContain("hidden");
    expect(selected.join(" ")).not.toContain("!quote");
  });

  it("reports separate semantic contexts", () => {
    const markdown = "first paragraph\n\nsecond paragraph";
    expect(markdownContexts(markdown).map((context) => markdown.slice(context.from, context.to)))
      .toEqual(["first paragraph", "second paragraph"]);
  });

  it("excludes emphasis, HTML, and escape syntax characters", () => {
    const markdown = "**bold** *em* <span>text</span> escaped \\* symbol";
    const selected = eligibleSelectionRanges(markdown, { from: 0, to: markdown.length })
      .map((range) => markdown.slice(range.from, range.to));
    expect(selected).toEqual(["bold", "em", "text", "escaped", "symbol"]);
  });

  it("groups matching annotations once per source context in source order", () => {
    const markdown = "alpha beta gamma\n\ndelta epsilon";
    const projection = annotationProjection(markdown, [
      { id: "b", tagId: "idea", from: 6, to: 10 },
      { id: "c", tagId: "other", from: 11, to: 16 },
      { id: "a", tagId: "idea", from: 0, to: 5 },
      { id: "d", tagId: "idea", from: 18, to: 23 },
    ], "idea");
    expect(projection).toEqual([
      { from: 0, to: 16, matches: [{ from: 0, to: 5 }, { from: 6, to: 10 }] },
      { from: 18, to: 31, matches: [{ from: 18, to: 23 }] },
    ]);
  });
});
