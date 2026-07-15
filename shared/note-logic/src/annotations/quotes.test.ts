import { describe, expect, it } from "vitest";
import { mapQuoteSources } from "./quotes";

describe("quote-source mapping", () => {
  const source = [{ cardFrom: 0, bundleId: "com.example.app" }];

  it("re-anchors after replacing the complete title", () => {
    const oldMarkdown = "> [!quote] Old\n> body";
    const insert = "> [!quote] New";
    expect(mapQuoteSources(oldMarkdown, `${insert}\n> body`, source, [
      { from: 0, to: 14, insert },
    ])).toEqual(source);
  });

  it("re-anchors after inserting a line before the title", () => {
    const oldMarkdown = "> [!quote] App\n> body";
    const insert = "intro\n";
    expect(mapQuoteSources(oldMarkdown, insert + oldMarkdown, source, [
      { from: 0, to: 0, insert },
    ])).toEqual([{ ...source[0], cardFrom: insert.length }]);
  });

  it("drops identity when the card is deleted instead of attaching to the next card", () => {
    const first = "> [!quote] First\n> body\n";
    const second = "> [!quote] Second\n> body";
    expect(mapQuoteSources(first + second, second, source, [
      { from: 0, to: first.length, insert: "" },
    ])).toEqual([]);
  });
});
