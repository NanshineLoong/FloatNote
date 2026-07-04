import { describe, it, expect } from "vitest";
import { htmlToMarkdown, adaptPasteForQuote } from "./paste";

describe("htmlToMarkdown", () => {
  it("converts an unordered list to dash bullets", () => {
    const html = "<ul><li>味道</li><li>品尝</li></ul>";
    expect(htmlToMarkdown(html)).toBe("- 味道\n- 品尝");
  });

  it("converts an ordered list to numbered items", () => {
    const html = "<ol><li>first</li><li>second</li></ol>";
    expect(htmlToMarkdown(html)).toBe("1. first\n2. second");
  });

  it("preserves bold and italic", () => {
    const html = "<strong>bold</strong> and <em>ital</em>";
    expect(htmlToMarkdown(html)).toBe("**bold** and *ital*");
  });

  it("converts a table to a markdown table", () => {
    const html =
      "<table><tr><th>k</th><th>v</th></tr><tr><td>1</td><td>2</td></tr></table>";
    expect(htmlToMarkdown(html)).toBe(
      "| k | v |\n| --- | --- |\n| 1 | 2 |",
    );
  });

  it("returns empty string for whitespace-only html", () => {
    expect(htmlToMarkdown("   \n  ")).toBe("");
  });

  it("strips clipboard wrapper markup but keeps content", () => {
    const html =
      '<meta charset="utf-8"><!--StartFragment--><p>hi</p><!--EndFragment-->';
    expect(htmlToMarkdown(html)).toBe("hi");
  });
});

describe("adaptPasteForQuote", () => {
  const list = "- 味道\n- 品尝";

  it("leaves single-line insert untouched even on a quote line", () => {
    expect(adaptPasteForQuote("> ", 2, 0, "plain")).toBe("plain");
  });

  it("returns insert as-is when not on a quote line", () => {
    expect(adaptPasteForQuote("some text", 9, 0, list)).toBe(list);
  });

  it("continues an empty `> ` line: first line joins, rest prefixed", () => {
    // line `> ` starts at offset 5, caret at end (offset 7, col 2)
    expect(adaptPasteForQuote("> ", 7, 5, list)).toBe("- 味道\n> - 品尝");
  });

  it("starts the paste on a fresh quoted line when the line has content", () => {
    // line `> existing` at offset 5, caret at end (offset 15, col 10)
    expect(adaptPasteForQuote("> existing", 15, 5, list)).toBe(
      "\n> - 味道\n> - 品尝",
    );
  });

  it("prefixes every pasted line on a bare `>` empty line", () => {
    // line `>` at offset 5, caret at end (offset 6, col 1)
    expect(adaptPasteForQuote(">", 6, 5, list)).toBe(" - 味道\n> - 品尝");
  });

  it("turns blank pasted lines into bare `>` so the quote block stays intact", () => {
    const md = "para one\n\npara two";
    // line `> ` at offset 0, caret at end (offset 2, col 2) — empty quote line
    expect(adaptPasteForQuote("> ", 2, 0, md)).toBe("para one\n>\n> para two");
  });
});
