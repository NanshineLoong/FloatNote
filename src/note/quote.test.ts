import { describe, it, expect } from "vitest";
import {
  type Source,
  quoteBody,
  buildQuoteBlock,
  sourceToChip,
  parseChips,
  buildBidMarker,
  stripBidMarker,
  readBidMarker,
  mergeQuoteBlock,
  isQuoteCardBlock,
  resolveMergeTarget,
} from "./quote";

const web = (title: string, url: string, bundleId: string | null = null): Source =>
  ({ kind: "web", title, url, bundleId });
const app = (title: string, bundleId: string | null = null): Source =>
  ({ kind: "app", title, url: null, bundleId });

describe("quoteBody", () => {
  it("prefixes each line with '> ' and turns blank lines into bare '>'", () => {
    expect(quoteBody("a\n\nb")).toBe("> a\n>\n> b");
  });
  it("single line", () => {
    expect(quoteBody("hello")).toBe("> hello");
  });
});

describe("buildQuoteBlock", () => {
  it("builds clean editor Markdown while bundle metadata stays out of the document", () => {
    expect(buildQuoteBlock("hello", web("GitHub", "https://github.com/x", "com.google.chrome")))
      .toBe("> [!quote] [GitHub](https://github.com/x)\n> hello");
  });
  it("omits the bid marker when source has no bundleId", () => {
    expect(buildQuoteBlock("hello", web("GitHub", "https://github.com/x", null)))
      .toBe("> [!quote] [GitHub](https://github.com/x)\n> hello");
  });
  it("empty title line when source is null", () => {
    expect(buildQuoteBlock("hello", null)).toBe("> [!quote]\n> hello");
  });
  it("app chip is bare text without inline metadata", () => {
    expect(buildQuoteBlock("hi", app("终端", "com.apple.terminal")))
      .toBe("> [!quote] 终端\n> hi");
  });
  it("app chip without bundleId", () => {
    expect(buildQuoteBlock("hi", app("终端", null))).toBe("> [!quote] 终端\n> hi");
  });
  it("multi-line body preserves blank lines", () => {
    expect(buildQuoteBlock("a\n\nb", null)).toBe("> [!quote]\n> a\n>\n> b");
  });
});

describe("bid marker helpers", () => {
  it("buildBidMarker formats the comment", () => {
    expect(buildBidMarker("com.google.chrome")).toBe("<!-- floatnote:bid=com.google.chrome -->");
  });
  it("stripBidMarker removes only the bid comment, leaves the rest", () => {
    expect(stripBidMarker("[GitHub](https://x)<!-- floatnote:bid=com.google.chrome -->"))
      .toBe("[GitHub](https://x)");
  });
  it("readBidMarker reads the id from a block", () => {
    expect(readBidMarker("> [!quote] 终端<!-- floatnote:bid=com.apple.terminal -->\n> hi"))
      .toBe("com.apple.terminal");
  });
  it("readBidMarker returns null when absent", () => {
    expect(readBidMarker("> [!quote] 终端\n> hi")).toBeNull();
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

describe("parseChips × floatnote markers", () => {
  it("strips a trailing bid marker before chip parsing", () => {
    // parsed chips never carry a bundleId (it lives in the per-card marker)
    expect(parseChips("[GitHub](https://github.com/x)<!-- floatnote:bid=com.google.chrome -->"))
      .toEqual([web("GitHub", "https://github.com/x", null)]);
  });
});

describe("mergeQuoteBlock", () => {
  it("appends body after a '>' blank separator, preserving the title line + bid", () => {
    const existing = "> [!quote] [GitHub](https://github.com/x)<!-- floatnote:bid=com.google.chrome -->\n> first";
    expect(mergeQuoteBlock(existing, "second"))
      .toBe("> [!quote] [GitHub](https://github.com/x)<!-- floatnote:bid=com.google.chrome -->\n> first\n>\n> second");
  });
  it("merges into a card with empty body (title only)", () => {
    expect(mergeQuoteBlock("> [!quote]", "first")).toBe("> [!quote]\n> first");
  });
  it("leaves an untagged card untagged after merge", () => {
    const existing = "> [!quote] [A](https://a)\n> first";
    expect(mergeQuoteBlock(existing, "more")).not.toContain("floatnote:tag");
  });
  it("does not add or modify chips (same-source merge keeps the title as-is)", () => {
    const existing = "> [!quote] [A](https://a)<!-- floatnote:bid=c -->\n> x";
    // even if a second body is merged, the chip + bid line is unchanged
    expect(mergeQuoteBlock(existing, "y").split("\n", 1)[0])
      .toBe("> [!quote] [A](https://a)<!-- floatnote:bid=c -->");
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
  const webCard = (url: string, bid = "com.google.chrome") =>
    `> [!quote] [GitHub](${url})<!-- floatnote:bid=${bid} -->\n> first\n> second`;
  const appCard = (title: string, bid: string | null) =>
    bid ? `> [!quote] ${title}<!-- floatnote:bid=${bid} -->\n> first` : `> [!quote] ${title}\n> first`;

  it("merges when caret is inside a same-source card", () => {
    const doc = webCard("https://github.com/x");
    const caret = doc.indexOf("second");
    const t = resolveMergeTarget(doc, caret, web("GitHub", "https://github.com/x", "com.google.chrome"));
    expect(t.kind).toBe("merge");
  });

  it("merges when caret is on the title line of a same-source card", () => {
    const doc = `> [!quote] [A](https://a)<!-- floatnote:bid=c -->\n> first`;
    const caret = doc.indexOf("[A]");
    expect(resolveMergeTarget(doc, caret, web("A", "https://a", "c")).kind).toBe("merge");
  });

  it("merges when caret is in blank lines immediately after a same-source card", () => {
    const doc = `${webCard("https://github.com/x")}\n\n\n`;
    const caret = doc.length;
    const t = resolveMergeTarget(doc, caret, web("GitHub", "https://github.com/x", "com.google.chrome"));
    expect(t.kind).toBe("merge");
  });

  it("does not merge when the url differs (different web source) — new block after the card", () => {
    const doc = webCard("https://github.com/x");
    const caret = doc.indexOf("second");
    const t = resolveMergeTarget(doc, caret, web("GitHub", "https://other.com", "com.google.chrome"));
    expect(t.kind).toBe("new");
    if (t.kind === "new") expect(t.at).toBe(doc.length); // after the card, not at caret
  });

  it("does not merge when the app (bundleId) differs", () => {
    const doc = appCard("终端", "com.apple.terminal");
    const caret = doc.indexOf("first");
    const t = resolveMergeTarget(doc, caret, app("终端", "com.apple.other"));
    expect(t.kind).toBe("new");
    if (t.kind === "new") expect(t.at).toBe(doc.length);
  });

  it("different source inside a card: new block after the card, not splitting it", () => {
    const doc = webCard("https://github.com/x");
    const caret = doc.indexOf("first"); // inside the card body
    const t = resolveMergeTarget(doc, caret, app("Other", "com.apple.finder"));
    expect(t.kind).toBe("new");
    if (t.kind === "new") expect(t.at).toBe(doc.length);
  });

  it("legacy card without bid marker: falls back to title for app identity", () => {
    const doc = `> [!quote] 终端\n> first`;
    const caret = doc.indexOf("first");
    // same app name → merge even though neither side has a bid marker
    expect(resolveMergeTarget(doc, caret, app("终端", null)).kind).toBe("merge");
  });

  it("legacy card: different app name does not merge", () => {
    const doc = `> [!quote] 终端\n> first`;
    const caret = doc.indexOf("first");
    expect(resolveMergeTarget(doc, caret, app("访达", null)).kind).toBe("new");
  });

  it("does not merge when a non-quote block sits between the card and caret", () => {
    const doc = `${webCard("https://github.com/x")}\n\nplain paragraph\n\n`;
    const caret = doc.length;
    expect(resolveMergeTarget(doc, caret, web("GitHub", "https://github.com/x", "com.google.chrome")).kind)
      .toBe("new");
  });

  it("does not merge when the preceding block is a plain blockquote", () => {
    const doc = "> plain\n> text\n\n";
    const caret = doc.length;
    expect(resolveMergeTarget(doc, caret, app("plain", null)).kind).toBe("new");
  });

  it("new at caret when no nearby card", () => {
    expect(resolveMergeTarget("plain text here", 5, web("A", "https://a", "c")))
      .toEqual({ kind: "new", at: 5 });
  });

  it("new at caret in an empty doc", () => {
    expect(resolveMergeTarget("", 0, web("A", "https://a", "c"))).toEqual({ kind: "new", at: 0 });
  });
});
