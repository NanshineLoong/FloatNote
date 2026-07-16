import { describe, expect, it } from "vitest";
import { filterPaths, searchDocuments } from "./search.js";

describe("workspace search", () => {
  it("grep searches clean Inbox text and reports clean line numbers", () => {
    const result = searchDocuments(
      [{ path: "_inbox.md", content: "one\ntwo tagged\nthree" }],
      { pattern: "tagged", literal: true, limit: 100 },
    );
    expect(result.text).toContain("_inbox.md:2:two tagged");
  });

  it("counts CRLF input as logical lines without leaking carriage returns", () => {
    const result = searchDocuments(
      [{ path: "piece.md", content: "one\r\ntwo\r\nthree" }],
      { pattern: "two", literal: true, limit: 100 },
    );
    expect(result.text).toContain("piece.md:2:two");
    expect(result.text).not.toContain("\r");
  });

  it("uses bounded RE2 matching and rejects invalid search inputs", () => {
    expect(searchDocuments(
      [{ path: "piece.md", content: "Alpha\nbeta" }],
      { pattern: "alpha", ignoreCase: true, limit: 100 },
    ).text).toContain("piece.md:1:Alpha");
    expect(() => searchDocuments([], { pattern: "(", limit: 100 })).toThrow("正则");
    expect(() => searchDocuments([], { pattern: "x".repeat(257), limit: 100 })).toThrow("256");
    expect(() => searchDocuments([], { pattern: "x", context: 11, limit: 100 })).toThrow("context");
  });

  it("matches flat-root globs without accepting path separators", () => {
    expect(filterPaths(["_inbox.md", "Ideas.md", "notes.txt"], "*.md"))
      .toEqual(["_inbox.md", "Ideas.md"]);
    expect(() => filterPaths(["Ideas.md"], "nested/*.md")).toThrow("子目录");
    expect(() => filterPaths(["Ideas.md"], "nested\\*.md")).toThrow("子目录");
  });
});
