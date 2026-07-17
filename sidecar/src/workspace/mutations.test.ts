import { describe, expect, it } from "vitest";
import { decodeInbox, encodeInbox } from "@floatnote/note-logic";
import { SessionSkillView, SkillRegistry } from "../skills.js";
import { WorkspaceClient } from "./types.js";
import { prepareCreatePiece, prepareEdit, prepareTagMutation, prepareWrite } from "./mutations.js";

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
  it("rejects a missing target and directs the Agent to create_piece", async () => {
    const empty = workspace([], {});
    await expect(prepareWrite(empty, { path: "Ideas.md", content: "# Ideas" }))
      .rejects.toThrow("USE_CREATE_PIECE");
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

describe("prepareCreatePiece", () => {
  it("turns a natural title into one canonical root-level piece filename", async () => {
    const prepared = await prepareCreatePiece(workspace([], {}), {
      title: "  AI 内化／Tutor 的想法.md  ",
      content: "# 想法",
    });
    expect(prepared).toMatchObject({
      path: "AI 内化／Tutor 的想法.md",
      operation: "create",
      createOnly: true,
      oldContent: "",
      newContent: "# 想法",
    });
  });

  it.each([
    ["输入/输出", "输入-输出.md"],
    ["CON", "CON-note.md"],
  ])("normalizes the cross-platform title %s", async (title, expectedPath) => {
    const prepared = await prepareCreatePiece(workspace([], {}), { title, content: "" });
    expect(prepared.path).toBe(expectedPath);
  });

  it("reports a collision as an existing piece instead of overwriting it", async () => {
    const existing = workspace(
      [{ path: "Ideas.md", kind: "piece" }],
      { "Ideas.md": "existing" },
    );
    await expect(prepareCreatePiece(existing, { title: "Ideas", content: "new" }))
      .rejects.toThrow("PIECE_ALREADY_EXISTS");
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
