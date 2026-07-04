import { describe, it, expect } from "vitest";
import {
  type Source,
  quoteBody,
  buildQuoteBlock,
  sourceToChip,
  parseChips,
  mergeQuoteBlock,
  isQuoteCardBlock,
  resolveMergeTarget,
} from "./quote";
const web = (title: string, url: string): Source => ({ kind: "web", title, url });
const app = (title: string): Source => ({ kind: "app", title, url: null });

describe("quoteBody", () => {
  it("prefixes each line with '> ' and turns blank lines into bare '>'", () => {
    expect(quoteBody("a\n\nb")).toBe("> a\n>\n> b");
  });
  it("single line", () => {
    expect(quoteBody("hello")).toBe("> hello");
  });
});

describe("buildQuoteBlock", () => {
  it("builds a title line with a web chip + body", () => {
    expect(buildQuoteBlock("hello", web("GitHub", "https://github.com/x")))
      .toBe("> [!quote] [GitHub](https://github.com/x)\n> hello");
  });
  it("empty title line when source is null", () => {
    expect(buildQuoteBlock("hello", null)).toBe("> [!quote]\n> hello");
  });
  it("app chip is bare text", () => {
    expect(buildQuoteBlock("hi", app("终端"))).toBe("> [!quote] 终端\n> hi");
  });
  it("multi-line body preserves blank lines", () => {
    expect(buildQuoteBlock("a\n\nb", null)).toBe("> [!quote]\n> a\n>\n> b");
  });
});

describe("sourceToChip / parseChips round-trip", () => {
  it("round-trips a single web chip", () => {
    const s = web("GitHub", "https://github.com/x");
    expect(parseChips(sourceToChip(s))).toEqual([s]);
  });
  it("round-trips a single app chip", () => {
    const s = app("终端");
    expect(parseChips(sourceToChip(s))).toEqual([s]);
  });
  it("parses mixed web+app separated by ' · '", () => {
    const str = "[GitHub](https://github.com/x) · 终端 · [HN](https://news.ycombinator.com)";
    expect(parseChips(str)).toEqual([
      web("GitHub", "https://github.com/x"),
      app("终端"),
      web("HN", "https://news.ycombinator.com"),
    ]);
  });
  it("trims surrounding whitespace per chip", () => {
    expect(parseChips("  终端  ")).toEqual([app("终端")]);
  });
  it("malformed '[text](' fragment becomes an app chip", () => {
    expect(parseChips("[broken(")).toEqual([app("[broken(")]);
  });
});

describe("mergeQuoteBlock", () => {
  it("appends body after a '>' blank separator", () => {
    const existing = "> [!quote] [GitHub](https://github.com/x)\n> first";
    expect(mergeQuoteBlock(existing, "second", null))
      .toBe("> [!quote] [GitHub](https://github.com/x)\n> first\n>\n> second");
  });
  it("adds a new web chip", () => {
    const existing = "> [!quote] [GitHub](https://github.com/x)\n> first";
    expect(mergeQuoteBlock(existing, "second", web("HN", "https://news.ycombinator.com")))
      .toBe("> [!quote] [GitHub](https://github.com/x) · [HN](https://news.ycombinator.com)\n> first\n>\n> second");
  });
  it("dedups web by url (case-insensitive, trailing slash)", () => {
    const existing = "> [!quote] [GitHub](https://github.com/x/)\n> first";
    expect(mergeQuoteBlock(existing, "second", web("GitHub", "HTTPS://github.com/x")))
      .toBe("> [!quote] [GitHub](https://github.com/x/)\n> first\n>\n> second");
  });
  it("dedups app by exact title", () => {
    const existing = "> [!quote] 终端\n> first";
    expect(mergeQuoteBlock(existing, "second", app("终端")))
      .toBe("> [!quote] 终端\n> first\n>\n> second");
  });
  it("does not dedup web vs app", () => {
    const existing = "> [!quote] [GitHub](https://github.com/x)\n> first";
    expect(mergeQuoteBlock(existing, "second", app("GitHub")))
      .toBe("> [!quote] [GitHub](https://github.com/x) · GitHub\n> first\n>\n> second");
  });
  it("preserves existing chip order", () => {
    const existing = "> [!quote] [A](https://a) · [B](https://b)\n> x";
    expect(mergeQuoteBlock(existing, "y", web("C", "https://c")))
      .toBe("> [!quote] [A](https://a) · [B](https://b) · [C](https://c)\n> x\n>\n> y");
  });
  it("merges into a card with empty body (title only)", () => {
    expect(mergeQuoteBlock("> [!quote]", "first", null)).toBe("> [!quote]\n> first");
  });
  it("adds chip when merging into a title-only card", () => {
    expect(mergeQuoteBlock("> [!quote]", "first", web("A", "https://a")))
      .toBe("> [!quote] [A](https://a)\n> first");
  });
  it("lenient on malformed title: unrecognised text becomes an app chip", () => {
    const existing = "> [!quote] some weird title\n> first";
    expect(mergeQuoteBlock(existing, "second", web("A", "https://a")))
      .toBe("> [!quote] some weird title · [A](https://a)\n> first\n>\n> second");
  });
});

describe("isQuoteCardBlock", () => {
  it("matches '> [!quote]'", () => {
    expect(isQuoteCardBlock("> [!quote]\n> x")).toBe(true);
  });
  it("matches extra spaces and '>[!quote]'", () => {
    expect(isQuoteCardBlock(">  [!quote] x")).toBe(true);
    expect(isQuoteCardBlock(">[!quote] x")).toBe(true);
  });
  it("rejects plain blockquote", () => {
    expect(isQuoteCardBlock("> text")).toBe(false);
  });
});

describe("resolveMergeTarget", () => {
  it("merges when caret is inside a [!quote] card", () => {
    const doc = "> [!quote] [A](https://a)\n> first\n> second";
    // caret in the middle of the second body line
    const caret = doc.indexOf("second");
    const t = resolveMergeTarget(doc, caret);
    expect(t.kind).toBe("merge");
    if (t.kind === "merge") expect(t.range.from).toBe(0);
  });

  it("merges when caret is on the title line of a [!quote] card", () => {
    const doc = "> [!quote] [A](https://a)\n> first";
    const caret = doc.indexOf("[A]");
    expect(resolveMergeTarget(doc, caret).kind).toBe("merge");
  });

  it("merges when caret is in blank lines immediately after a card", () => {
    const doc = "> [!quote] [A](https://a)\n> first\n\n\n";
    const caret = doc.length;
    const t = resolveMergeTarget(doc, caret);
    expect(t.kind).toBe("merge");
    if (t.kind === "merge") expect(doc.slice(t.range.from, t.range.to)).toContain("first");
  });

  it("does not merge when a non-quote block sits between the card and caret", () => {
    const doc = "> [!quote] [A](https://a)\n> first\n\nplain paragraph\n\n";
    const caret = doc.length;
    expect(resolveMergeTarget(doc, caret).kind).toBe("new");
  });

  it("does not merge when the preceding block is a plain blockquote", () => {
    const doc = "> plain\n> text\n\n";
    const caret = doc.length;
    expect(resolveMergeTarget(doc, caret).kind).toBe("new");
  });

  it("new card when caret is in an empty doc", () => {
    expect(resolveMergeTarget("", 0).kind).toBe("new");
  });

  it("caret == 0 on a card is the inside case (merge)", () => {
    const doc = "> [!quote] [A](https://a)\n> first";
    const caret = 0;
    // caret == 0 is inside the card (from == 0), so this is the inside case.
    expect(resolveMergeTarget(doc, caret).kind).toBe("merge");
  });
});
