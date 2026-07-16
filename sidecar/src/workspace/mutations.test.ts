import { describe, expect, it } from "vitest";
import { decodeInbox, encodeInbox } from "@floatnote/note-logic";
import { SessionSkillView, SkillRegistry } from "../skills.js";
import { WorkspaceClient } from "./types.js";
import { prepareEdit, prepareTagMutation, prepareWrite } from "./mutations.js";

function workspace(entries: Array<{ path: string; kind: "inbox" | "tasks" | "piece" }>, files: Record<string, string>) {
  return new WorkspaceClient({
    async list() { return entries; },
    async read(path) {
      if (!(path in files)) throw new Error("missing");
      return files[path];
    },
  }, new SessionSkillView(new SkillRegistry().snapshot()));
}

function annotatedInbox(): string {
  return encodeInbox("first second third", {
    tags: [{ id: "review", name: "复习", color: "#e5484d" }],
    annotations: [{ id: "a", tagId: "review", from: 6, to: 12 }],
    quoteSources: [],
  });
}

describe("prepareEdit", () => {
  it("applies disjoint edits against the same original and maps Inbox metadata once", async () => {
    const prepared = await prepareEdit(workspace(
      [{ path: "_inbox.md", kind: "inbox" }],
      { "_inbox.md": annotatedInbox() },
    ), {
      path: "_inbox.md",
      edits: [
        { oldText: "first", newText: "FIRST" },
        { oldText: "third", newText: "THIRD" },
      ],
    });
    expect(decodeInbox(prepared.newContent).markdown).toBe("FIRST second THIRD");
    expect(decodeInbox(prepared.newContent).metadata.annotations).toHaveLength(1);
  });

  it("rejects overlapping or non-unique edits before review", async () => {
    const duplicate = workspace([{ path: "piece.md", kind: "piece" }], { "piece.md": "same same" });
    await expect(prepareEdit(duplicate, {
      path: "piece.md",
      edits: [{ oldText: "same", newText: "x" }],
    })).rejects.toThrow("不唯一");
    const overlap = workspace([{ path: "piece.md", kind: "piece" }], { "piece.md": "abcdef" });
    await expect(prepareEdit(overlap, {
      path: "piece.md",
      edits: [
        { oldText: "abcd", newText: "x" },
        { oldText: "cdef", newText: "y" },
      ],
    })).rejects.toThrow("重叠");
  });
});

describe("prepareWrite", () => {
  it("uses write create-only only for a missing piece", async () => {
    const empty = workspace([], {});
    const prepared = await prepareWrite(empty, { path: "Ideas.md", content: "# Ideas" });
    expect(prepared).toMatchObject({ operation: "create", createOnly: true, oldContent: "" });
    await expect(prepareWrite(empty, { path: "_tasks.md", content: "- [ ] x" }))
      .rejects.toThrow("系统文件");
  });

  it("rejects whole Inbox rewrite while text annotations exist", async () => {
    await expect(prepareWrite(workspace(
      [{ path: "_inbox.md", kind: "inbox" }],
      { "_inbox.md": annotatedInbox() },
    ), { path: "_inbox.md", content: "new" })).rejects.toThrow("请使用 edit");
  });

  it("preserves tag definitions and clears quote sources for an unannotated Inbox rewrite", async () => {
    const raw = encodeInbox("old quote", {
      tags: [{ id: "review", name: "复习", color: "#e5484d" }],
      annotations: [],
      quoteSources: [{ cardFrom: 0, bundleId: "com.example.browser" }],
    });
    const prepared = await prepareWrite(workspace(
      [{ path: "_inbox.md", kind: "inbox" }],
      { "_inbox.md": raw },
    ), { path: "_inbox.md", content: "replacement" });
    const decoded = decodeInbox(prepared.newContent);
    expect(decoded.markdown).toBe("replacement");
    expect(decoded.metadata.tags).toHaveLength(1);
    expect(decoded.metadata.quoteSources).toEqual([]);
  });
});

describe("prepareTagMutation", () => {
  it("prepares an Inbox tag assignment with the existing semantic preview", async () => {
    const raw = encodeInbox("first second", {
      tags: [{ id: "review", name: "复习", color: "#e5484d" }],
      annotations: [],
      quoteSources: [],
    });
    const prepared = await prepareTagMutation(workspace(
      [{ path: "_inbox.md", kind: "inbox" }],
      { "_inbox.md": raw },
    ), "tag_text", { exact: "second", tagId: "review", action: "add" });
    expect(prepared.operation).toBe("tag");
    expect(prepared.preview.detail).toMatchObject({
      kind: "tag_assign",
      targetText: "second",
      tagName: "复习",
    });
    expect(decodeInbox(prepared.newContent).metadata.annotations).toHaveLength(1);
  });
});
