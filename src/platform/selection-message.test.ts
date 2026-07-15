import { describe, expect, it } from "vitest";
import { buildSelectionMessage, parseSelectionMessage } from "./selection-message";

describe("selection message codec", () => {
  it("roundtrips a web selection with a safe URL", () => {
    const markdown = buildSelectionMessage({
      question: "为什么强调媒介？",
      selection: "The medium is the message.\nSecond line.",
      source: { kind: "web", title: "Understanding Media", url: "https://example.com/a?q=1" },
    });

    expect(markdown).toBe(
      "为什么强调媒介？\n\n> [!selection] [Understanding Media](https://example.com/a?q=1)\n> The medium is the message.\n> Second line.",
    );
    expect(parseSelectionMessage(markdown)).toEqual({
      question: "为什么强调媒介？",
      selection: "The medium is the message.\nSecond line.",
      source: { label: "Understanding Media", url: "https://example.com/a?q=1" },
    });
  });

  it("escapes source syntax and rejects unsafe URLs", () => {
    const markdown = buildSelectionMessage({
      question: "Q",
      selection: "quoted",
      source: { kind: "web", title: "A [title]", url: "javascript:alert(1)" },
    });

    expect(markdown).toContain("> [!selection] A \\[title\\]");
    expect(markdown).not.toContain("javascript:");
    expect(parseSelectionMessage(markdown)?.source).toEqual({ label: "A [title]", url: null });
  });

  it("does not misclassify similar or trailing content", () => {
    expect(parseSelectionMessage("hello\n\n> [!selection-ish] source\n> quote")).toBeNull();
    expect(parseSelectionMessage("hello\n\n> [!selection] source\n> quote\nnot part")).toBeNull();
    expect(parseSelectionMessage("\n\n> [!selection] source\n> quote")).toBeNull();
  });

  it("roundtrips safe URLs containing parentheses", () => {
    const markdown = buildSelectionMessage({
      question: "Q",
      selection: "quote",
      source: { kind: "web", title: "Page", url: "https://example.com/wiki/A_(B)" },
    });
    expect(markdown).toContain("A_%28B%29");
    expect(parseSelectionMessage(markdown)?.source.url).toBe("https://example.com/wiki/A_%28B%29");
  });
});
