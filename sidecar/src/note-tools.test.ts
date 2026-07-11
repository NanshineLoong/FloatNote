import { describe, it, expect, vi } from "vitest";
import { createNoteTools, type NoteToolDeps } from "./note-tools.js";

function makeDups(noteText: string): { deps: NoteToolDeps; writes: any[] } {
  const writes: any[] = [];
  const deps: NoteToolDeps = {
    getNoteText: async () => noteText,
    listNotes: async () => [
      { kind: "inbox", name: "_inbox.md" },
      { kind: "tasks", name: "_tasks.md" },
      { kind: "piece", name: "piece.md" },
    ],
    requestCreateNote: async () => ({ ok: true, name: "new-piece.md" }),
    requestWrite: async (args) => {
      writes.push(args);
      return { ok: true, version: 1 };
    },
    readSkillBody: () => null,
  };
  return { deps, writes };
}

describe("project note tools", () => {
  it("lists only project-space targets", async () => {
    const { deps } = makeDups("");
    const tools = createNoteTools(deps);
    const list = tools.find((t) => t.name === "list_notes")!;
    const result = await (list as any).execute("id", {});
    expect(JSON.parse(result.content[0].text)).toEqual([
      { kind: "inbox", name: "_inbox.md" },
      { kind: "tasks", name: "_tasks.md" },
      { kind: "piece", name: "piece.md" },
    ]);
  });

  it("requests confirmed creation with a semantic preview", async () => {
    const { deps } = makeDups("");
    let request: any;
    deps.requestCreateNote = async (args) => {
      request = args;
      return { ok: true, name: "ideas.md" };
    };
    const tools = createNoteTools(deps);
    const create = tools.find((t) => t.name === "create_note")!;
    const result = await (create as any).execute("tool-1", { title: "ideas", content: "first" });
    expect(request).toMatchObject({ toolCallId: "tool-1", title: "ideas", content: "first" });
    expect(request.preview.detail).toEqual({ kind: "note_create", filename: "ideas.md", contentPreview: "first" });
    expect(result.content[0].text).toContain("ideas.md");
  });
});

describe("edit_note", () => {
  it("replaces unique substring", async () => {
    const { deps, writes } = makeDups("a\nb\nc");
    const tools = createNoteTools(deps);
    const edit = tools.find((t) => t.name === "edit_note")!;
    await (edit as any).execute("id", { old_string: "b", new_string: "B" });
    expect(writes[0].newContent).toBe("a\nB\nc");
    expect(writes[0].preview.detail.kind).toBe("diff");
  });
  it("errors on non-unique", async () => {
    const { deps } = makeDups("a a a");
    const tools = createNoteTools(deps);
    const edit = tools.find((t) => t.name === "edit_note")!;
    const r = await (edit as any).execute("id", { old_string: "a", new_string: "b" });
    expect(r.content[0].text).toContain("不唯一");
  });
});

describe("set_tag", () => {
  it("attaches tag marker to anchored block", async () => {
    const note = "<!-- floatnote-tags: review=\"复习\"|c=#e5484d -->\n\n第一块\n\n第二块";
    const { deps, writes } = makeDups(note);
    const tools = createNoteTools(deps);
    const set = tools.find((t) => t.name === "set_tag")!;
    await (set as any).execute("id", { anchor: "第二块", tagId: "review" });
    expect(writes[0].newContent).toContain("<!-- floatnote:tag=review -->");
    expect(writes[0].preview.detail.kind).toBe("tag_assign");
  });
});

describe("tag_create", () => {
  it("adds defs entry", async () => {
    const { deps, writes } = makeDups("第一块");
    const tools = createNoteTools(deps);
    const c = tools.find((t) => t.name === "tag_create")!;
    await (c as any).execute("id", { name: "重点", color: "#e5484d" });
    expect(writes[0].newContent).toContain("重点");
  });
  it("rejects non-palette color", async () => {
    const { deps, writes } = makeDups("第一块");
    const tools = createNoteTools(deps);
    const c = tools.find((t) => t.name === "tag_create")!;
    const r = await (c as any).execute("id", { name: "重点", color: "#000000" });
    expect(r.content[0].text).toContain("不可用");
    expect(writes.length).toBe(0);
  });
  it("rejects already-taken color", async () => {
    const note = '<!-- floatnote-tags: review="复习"|c=#e5484d -->\n第一块';
    const { deps, writes } = makeDups(note);
    const tools = createNoteTools(deps);
    const c = tools.find((t) => t.name === "tag_create")!;
    const r = await (c as any).execute("id", { name: "重点", color: "#e5484d" });
    expect(r.content[0].text).toContain("不可用");
    expect(writes.length).toBe(0);
  });
});

describe("list_tags", () => {
  it("returns defs and free colors", async () => {
    const note = "<!-- floatnote-tags: review=\"复习\"|c=#e5484d -->\n第一块";
    const { deps } = makeDups(note);
    const tools = createNoteTools(deps);
    const lt = tools.find((t) => t.name === "list_tags")!;
    const r = await (lt as any).execute("id", {});
    expect(r.content[0].text).toContain("review");
  });
});

describe("read_skill", () => {
  it("returns the skill body for a known name", async () => {
    const { deps } = makeDups("");
    deps.readSkillBody = () => "---\nname: x\ndescription: x\n---\n正文";
    const tools = createNoteTools(deps);
    const rs = tools.find((t) => t.name === "read_skill")!;
    const r = await (rs as any).execute("id", { name: "x" });
    expect(r.content[0].text).toContain("正文");
  });

  it("throws for an unknown skill name", async () => {
    const { deps } = makeDups("");
    const tools = createNoteTools(deps);
    const rs = tools.find((t) => t.name === "read_skill")!;
    await expect((rs as any).execute("id", { name: "missing" })).rejects.toThrow(/未知 skill/);
  });

  it("treats a path-like string as an unknown name (no traversal)", async () => {
    const { deps } = makeDups("");
    const tools = createNoteTools(deps);
    const rs = tools.find((t) => t.name === "read_skill")!;
    await expect((rs as any).execute("id", { name: "/etc/passwd" })).rejects.toThrow(/未知 skill/);
  });
});

describe("tag_delete", () => {
  it("removes defs entry and all block markers (multi-marker)", async () => {
    const note =
      "<!-- floatnote-tags: review=\"复习\"|c=#e5484d -->\n\n" +
      "<!-- floatnote:tag=review -->\n第一块\n\n" +
      "<!-- floatnote:tag=review -->\n第二块\n";
    const { deps, writes } = makeDups(note);
    const tools = createNoteTools(deps);
    const del = tools.find((t) => t.name === "tag_delete")!;
    await (del as any).execute("id", { tagId: "review" });
    expect(writes[0].newContent).not.toContain("floatnote:tag=review");
    expect(writes[0].newContent).not.toContain("floatnote-tags: review");
    expect(writes[0].newContent).toContain("第一块");
    expect(writes[0].newContent).toContain("第二块");
    expect(writes[0].preview.detail.kind).toBe("tag_delete");
    expect(writes[0].preview.detail.markerCount).toBe(2);
  });
});

describe("tag_update", () => {
  it("renames and recolors a definition without changing markers", async () => {
    const note = '<!-- floatnote-tags: review="复习"|c=#e5484d -->\n正文<!-- floatnote:tag=review -->';
    const { deps, writes } = makeDups(note);
    const tools = createNoteTools(deps);
    const update = tools.find((t) => t.name === "tag_update")!;
    await (update as any).execute("id", { tagId: "review", name: "重点", color: "#f5a623" });
    expect(writes[0].newContent).toContain('review="重点"|c=#f5a623');
    expect(writes[0].newContent).toContain("floatnote:tag=review");
    expect(writes[0].preview.detail.kind).toBe("tag_update");
  });
});
