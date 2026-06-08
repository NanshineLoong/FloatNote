import { describe, it, expect } from "vitest";
import { buildAppendInsert } from "./append";

describe("buildAppendInsert", () => {
  it("returns the block alone when the doc is empty", () => {
    expect(buildAppendInsert("", "> q")).toBe("> q");
  });

  it("returns the block alone when the doc is only whitespace", () => {
    expect(buildAppendInsert("   \n", "> q")).toBe("> q");
  });

  it("prefixes two newlines when the doc has content", () => {
    expect(buildAppendInsert("hello", "> q")).toBe("\n\n> q");
  });

  it("does not add extra blank lines when the doc already ends with a newline", () => {
    expect(buildAppendInsert("hello\n", "> q")).toBe("\n> q");
  });
});

