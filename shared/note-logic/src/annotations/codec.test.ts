import { describe, expect, it } from "vitest";
import { decodeInbox, encodeInbox } from "./codec";
import type { InboxMetadata } from "./types";

describe("Inbox v2 codec", () => {
  it("round-trips crossing annotations and quote source metadata", () => {
    const markdown = "> [!quote] Browser\n> break work into verifiable steps";
    const metadata: InboxMetadata = {
      tags: [
        { id: "concept", name: "观点", color: "#3b82f6" },
        { id: "verify", name: "待验证", color: "#f5a623" },
      ],
      annotations: [
        { id: "ann-a", tagId: "concept", from: 21, to: 36 },
        { id: "ann-b", tagId: "verify", from: 32, to: 47 },
      ],
      quoteSources: [{ cardFrom: 0, bundleId: "com.example.browser" }],
    };

    const encoded = encodeInbox(markdown, metadata);
    expect(encoded).toContain("floatnote:tags:v2");
    expect(encoded).toContain("floatnote:ann:v2 id=ann-a tag=concept start");
    expect(encoded).toContain("floatnote:bid=com.example.browser");
    expect(decodeInbox(encoded)).toEqual({ markdown, metadata, warnings: [] });
  });

  it("uses end-before-start order at a shared offset", () => {
    const encoded = encodeInbox("abcdef", {
      tags: [{ id: "idea", name: "Idea", color: "#3b82f6" }],
      annotations: [
        { id: "first", tagId: "idea", from: 0, to: 3 },
        { id: "second", tagId: "idea", from: 3, to: 6 },
      ],
      quoteSources: [],
    });
    expect(encoded.indexOf("id=first end")).toBeLessThan(encoded.indexOf("id=second tag=idea start"));
  });

  it("canonicalizes overlapping same-tag annotations read from disk", () => {
    const decoded = decodeInbox([
      '<!-- floatnote:tags:v2 idea="Idea"|c=#3b82f6 -->\n',
      '<!-- floatnote:ann:v2 id=a tag=idea start -->abc',
      '<!-- floatnote:ann:v2 id=b tag=idea start -->def<!-- floatnote:ann:v2 id=a end -->',
      'ghi<!-- floatnote:ann:v2 id=b end -->',
    ].join(""));
    expect(decoded.metadata.annotations).toEqual([{ id: "a", tagId: "idea", from: 0, to: 9 }]);
  });

  it("restores a quote source position after preceding Markdown", () => {
    const decoded = decodeInbox("intro\n\n> [!quote] App<!-- floatnote:bid=com.app -->\n> body");
    expect(decoded.markdown).toBe("intro\n\n> [!quote] App\n> body");
    expect(decoded.metadata.quoteSources).toEqual([{ cardFrom: 7, bundleId: "com.app" }]);
  });

  it("removes legacy metadata without migrating it", () => {
    const decoded = decodeInbox(
      '<!-- floatnote-tags: old="Old"|c=#fff -->\nhello<!-- floatnote:tag=old -->',
    );
    expect(decoded.markdown).toBe("hello");
    expect(decoded.metadata).toEqual({ tags: [], annotations: [], quoteSources: [] });
  });

  it("warns and drops orphaned, duplicate, and unknown-tag annotations", () => {
    const decoded = decodeInbox([
      '<!-- floatnote:tags:v2 idea="Idea"|c=#3b82f6 -->',
      '<!-- floatnote:ann:v2 id=missing tag=idea start -->one',
      '<!-- floatnote:ann:v2 id=dup tag=idea start -->two',
      '<!-- floatnote:ann:v2 id=dup tag=idea start -->three',
      '<!-- floatnote:ann:v2 id=dup end -->',
      '<!-- floatnote:ann:v2 id=ghost tag=unknown start -->x<!-- floatnote:ann:v2 id=ghost end -->',
    ].join("\n"));
    expect(decoded.metadata.annotations).toEqual([]);
    expect(decoded.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "orphan-marker",
      "duplicate-marker",
      "unknown-tag",
    ]));
    expect(decoded.markdown).not.toContain("floatnote:");
  });

  it("never exposes malformed v2 comments in the clean projection", () => {
    const decoded = decodeInbox([
      "<!-- floatnote:tags:v2 broken -->",
      "body<!-- floatnote:ann:v2 nonsense -->",
    ].join("\n"));
    expect(decoded.markdown).toBe("body");
    expect(decoded.warnings.some((warning) => warning.code === "malformed-metadata")).toBe(true);
  });

  it("round-trips a BOM-prefixed CRLF Inbox without losing annotations", () => {
    const raw = "\uFEFF<!-- floatnote:tags:v2 idea=\"Idea\"|c=#3b82f6 -->\r\n" +
      "hello<!-- floatnote:ann:v2 id=a tag=idea start --> world<!-- floatnote:ann:v2 id=a end -->\r\n";
    const decoded = decodeInbox(raw);
    expect(decoded.markdown).toBe("hello world\r\n");
    expect(decoded.metadata.annotations).toEqual([{ id: "a", tagId: "idea", from: 5, to: 11 }]);
    expect(decodeInbox(encodeInbox(decoded.markdown, decoded.metadata))).toEqual(decoded);
  });

  it.each([
    "<!-- floatnote:ann:v2 id=a tag=idea start-->",
    "<!-- floatnote:ann:v2 id=a start -->",
    "<!-- floatnote:ann:v2 id=BAD tag=idea start -->",
    "<!-- floatnote:ann:v2 id=a tag=idea start -- >",
  ])("strips damaged reserved metadata: %s", (marker) => {
    const decoded = decodeInbox(`before${marker}\nafter`);
    expect(decoded.markdown).not.toContain("floatnote");
    expect(decoded.markdown).toBe("before\nafter");
    expect(decoded.warnings.some((warning) => warning.code === "malformed-metadata")).toBe(true);
  });

  it("never writes tag names that would split the definition line", () => {
    const encoded = encodeInbox("body", {
      tags: [{ id: "bad", name: "line\nbreak", color: "#fff" }],
      annotations: [{ id: "a", tagId: "bad", from: 0, to: 4 }],
      quoteSources: [],
    });
    expect(encoded).toBe("body");
  });
});
