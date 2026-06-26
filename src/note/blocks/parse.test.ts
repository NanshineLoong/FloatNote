import { describe, it, expect } from "vitest";
import { parseBlocks, serializeBlocks, type Block } from "./parse";

describe("parseBlocks", () => {
  it("parses an unchecked and a checked todo, one block per line", () => {
    expect(parseBlocks("- [ ] 待办一\n- [x] 待办二")).toEqual([
      { kind: "todo", checked: false, text: "待办一" },
      { kind: "todo", checked: true, text: "待办二" },
    ]);
  });

  it("parses a callout with a type, title and body", () => {
    expect(parseBlocks("> [!quote] 来源\n> 引用正文\n> 第二行")).toEqual([
      { kind: "callout", calloutType: "quote", title: "来源", body: ["引用正文", "第二行"] },
    ]);
  });

  it("parses a plain blockquote as a quote block", () => {
    expect(parseBlocks("> 普通引用\n> 第二行")).toEqual([
      { kind: "quote", lines: ["普通引用", "第二行"] },
    ]);
  });

  it("parses free text (incl. multi-line paragraphs) as a text block", () => {
    expect(parseBlocks("自由文本\n第二行文本")).toEqual([
      { kind: "text", lines: ["自由文本", "第二行文本"] },
    ]);
  });

  it("splits adjacent kinds even without a blank line between them", () => {
    expect(parseBlocks("段落\n- [ ] 待办")).toEqual([
      { kind: "text", lines: ["段落"] },
      { kind: "todo", checked: false, text: "待办" },
    ]);
  });

  it("normalizes CRLF and ignores blank-line separators", () => {
    expect(parseBlocks("a\r\n\r\n\r\nb")).toEqual([
      { kind: "text", lines: ["a"] },
      { kind: "text", lines: ["b"] },
    ]);
  });
});

describe("serializeBlocks", () => {
  it("keeps consecutive todos in one list and blank-separates other blocks", () => {
    const blocks: Block[] = [
      { kind: "callout", calloutType: "quote", title: "来源", body: ["引用正文"] },
      { kind: "todo", checked: false, text: "待办一" },
      { kind: "todo", checked: true, text: "待办二" },
      { kind: "text", lines: ["自由文本"] },
    ];
    expect(serializeBlocks(blocks)).toBe(
      "> [!quote] 来源\n> 引用正文\n\n- [ ] 待办一\n- [x] 待办二\n\n自由文本",
    );
  });

  it("serializes an empty todo without a trailing space", () => {
    expect(serializeBlocks([{ kind: "todo", checked: false, text: "" }])).toBe("- [ ]");
  });

  it("round-trips a mixed document", () => {
    const md =
      "> [!quote] 来源\n> 引用正文\n> 第二行\n\n- [ ] 待办一\n- [x] 待办二\n\n自由文本\n第二行文本";
    expect(serializeBlocks(parseBlocks(md))).toBe(md);
  });
});
