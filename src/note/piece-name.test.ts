import { describe, it, expect } from "vitest";
import { sanitizePieceStem } from "./piece-name";

describe("sanitizePieceStem", () => {
  it("keeps a normal name", () => {
    expect(sanitizePieceStem("读书笔记")).toBe("读书笔记");
  });

  it("replaces path separators and illegal characters with -", () => {
    expect(sanitizePieceStem("a/b\\c:d*e?")).toBe("a-b-c-d-e-");
  });

  it("strips a leading underscore so a piece can't become a system file", () => {
    expect(sanitizePieceStem("_inbox")).toBe("inbox");
    expect(sanitizePieceStem("__x")).toBe("x");
  });

  it("drops a trailing .md extension", () => {
    expect(sanitizePieceStem("note.md")).toBe("note");
  });

  it("trims surrounding whitespace and dots", () => {
    expect(sanitizePieceStem("  draft.  ")).toBe("draft");
  });

  it("returns empty string for an all-illegal / empty input", () => {
    expect(sanitizePieceStem("   ")).toBe("");
    expect(sanitizePieceStem("___")).toBe("");
  });
});
