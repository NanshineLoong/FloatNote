import { describe, expect, it } from "vitest";
import { buildQuoteAppendChange, quoteCardRanges, resolveMergeTarget, type Source } from "./quote";

const app = (title: string, bundleId: string): Source => ({ kind: "app", title, url: null, bundleId });

describe("quote-card-specific ranges", () => {
  it("recognizes only a quote title and its consecutive quote lines", () => {
    const doc = "before\n\n> [!quote] Terminal\n> one\n> two\n\nafter";
    const ranges = quoteCardRanges(doc);
    expect(ranges).toEqual([{ from: 8, to: 39 }]);
    expect(doc.slice(ranges[0].from, ranges[0].to)).toBe("> [!quote] Terminal\n> one\n> two");
  });

  it("builds a minimal insertion at the quote body end", () => {
    expect(buildQuoteAppendChange("> [!quote] Terminal\n> one", 10, 36, "two"))
      .toEqual({ from: 36, to: 36, insert: "\n>\n> two" });
  });

  it("uses quote-source metadata for same-app matching", () => {
    const doc = "> [!quote] Terminal\n> one";
    expect(resolveMergeTarget(doc, doc.length, app("Renamed", "com.app"), [
      { cardFrom: 0, bundleId: "com.app" },
    ])).toEqual({ kind: "merge", range: { from: 0, to: doc.length } });
  });
});
