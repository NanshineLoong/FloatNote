import { describe, it, expect } from "vitest";
import { buildCaretInsert } from "./append";

describe("buildCaretInsert", () => {
  it("returns the block alone when inserting at the top of an empty doc", () => {
    expect(buildCaretInsert("", "", "> q")).toBe("> q");
  });

  it("adds no leading padding when the doc is only whitespace before the caret", () => {
    expect(buildCaretInsert("   \n", "", "> q")).toBe("> q");
  });

  it("prefixes two newlines when inserting at the end of a content line", () => {
    expect(buildCaretInsert("hello", "", "> q")).toBe("\n\n> q");
  });

  it("does not add extra blank lines when the doc already ends with a newline", () => {
    expect(buildCaretInsert("hello\n", "", "> q")).toBe("\n> q");
  });

  it("wraps the block with blank lines when the caret sits mid-line", () => {
    // "hello |world" -> "hello" + blank + quote + blank + "world"
    expect(buildCaretInsert("hello ", "world", "> q")).toBe("\n\n> q\n\n");
  });

  it("adds a leading newline when the caret is at the start of a content line", () => {
    // "hello\n|world" -> blank line before the block, blank line after
    expect(buildCaretInsert("hello\n", "world", "> q")).toBe("\n> q\n\n");
  });

  it("adds no leading padding when the caret is already on a blank line", () => {
    // "hello\n\n|world" -> block sits on the blank line
    expect(buildCaretInsert("hello\n\n", "world", "> q")).toBe("> q\n\n");
  });

  it("adds only a trailing newline when the caret is on a blank line followed by a newline", () => {
    // "hello\n|\nworld" -> blank line before, blank line after
    expect(buildCaretInsert("hello\n", "\nworld", "> q")).toBe("\n> q\n");
  });

  it("adds no trailing padding when the caret is at the end of the document", () => {
    expect(buildCaretInsert("hello", "", "> q")).toBe("\n\n> q");
  });
});
