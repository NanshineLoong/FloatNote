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
  it("serializes every tool that can request a write permission", () => {
    const writeToolNames = ["create_note", "edit_note", "write_note", "tag_text", "tag_create", "tag_update", "tag_delete"];
    const tools = createNoteTools(makeDups("").deps);

    expect(Object.fromEntries(tools.filter((tool) => writeToolNames.includes(tool.name)).map((tool) => [tool.name, tool.executionMode])))
      .toEqual(Object.fromEntries(writeToolNames.map((name) => [name, "sequential"])));
  });

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

  it("treats explicit piece metadata-like text as ordinary Markdown", async () => {
    const literal = "literal <!-- floatnote:ann:v2 id=a tag=b start --> text";
    const { deps, writes } = makeDups(literal);
    const tools = createNoteTools(deps);
    const read = tools.find((t) => t.name === "read_note")!;
    expect((await (read as any).execute("id", { target: { kind: "piece", name: "piece.md" } })).content[0].text)
      .toBe(literal);
    const edit = tools.find((t) => t.name === "edit_note")!;
    await (edit as any).execute("id", {
      target: { kind: "piece", name: "piece.md" }, old_string: "literal", new_string: "kept",
    });
    expect(writes[0].newContent).toContain("floatnote:ann:v2");
  });
});

describe("tag_text", () => {
  it("annotates exact clean text and rejects ambiguity", async () => {
    const note = "<!-- floatnote:tags:v2 review=\"复习\"|c=#e5484d -->\n第一块\n\n第二块";
    const { deps, writes } = makeDups(note);
    const tools = createNoteTools(deps);
    const set = tools.find((t) => t.name === "tag_text")!;
    await (set as any).execute("id", { exact: "第二块", tagId: "review", action: "add" });
    expect(writes[0].newContent).toContain("floatnote:ann:v2");
    expect(writes[0].preview.detail.kind).toBe("tag_assign");
  });

  it("carries the complete exact target alongside the compact excerpt", async () => {
    const exact = `目标第一行\n${"很长的目标文本".repeat(20)}`;
    const note = `<!-- floatnote:tags:v2 review="复习"|c=#e5484d -->\n${exact}`;
    const { deps, writes } = makeDups(note);
    const set = createNoteTools(deps).find((tool) => tool.name === "tag_text")!;

    await (set as any).execute("id", { exact, tagId: "review", action: "add" });

    expect(writes[0].preview.detail).toMatchObject({
      kind: "tag_assign",
      textExcerpt: exact.slice(0, 80),
      targetText: exact,
    });
  });

  it("rejects an empty exact target before requesting permission", async () => {
    const note = '<!-- floatnote:tags:v2 review="复习"|c=#e5484d -->\n正文';
    const { deps, writes } = makeDups(note);
    const set = createNoteTools(deps).find((tool) => tool.name === "tag_text")!;

    const result = await (set as any).execute("id", { exact: "", tagId: "review", action: "add" });

    expect(result.content[0].text).toContain("目标文本不能为空");
    expect(writes).toHaveLength(0);
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
    const note = '<!-- floatnote:tags:v2 review="复习"|c=#e5484d -->\n第一块';
    const { deps, writes } = makeDups(note);
    const tools = createNoteTools(deps);
    const c = tools.find((t) => t.name === "tag_create")!;
    const r = await (c as any).execute("id", { name: "重点", color: "#e5484d" });
    expect(r.content[0].text).toContain("不可用");
    expect(writes.length).toBe(0);
  });
  it("rejects a multiline name", async () => {
    const { deps, writes } = makeDups("第一块");
    const c = createNoteTools(deps).find((t) => t.name === "tag_create")!;
    const r = await (c as any).execute("id", { name: "bad\nname", color: "#e5484d" });
    expect(r.content[0].text).toContain("不能换行");
    expect(writes).toHaveLength(0);
  });
});

describe("list_tags", () => {
  it("returns defs and free colors", async () => {
    const note = "<!-- floatnote:tags:v2 review=\"复习\"|c=#e5484d -->\n第一块";
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
  it("removes a definition and all associated annotations", async () => {
    const note =
      "<!-- floatnote:tags:v2 review=\"复习\"|c=#e5484d -->\n" +
      "<!-- floatnote:ann:v2 id=a tag=review start -->第一块<!-- floatnote:ann:v2 id=a end -->\n\n" +
      "<!-- floatnote:ann:v2 id=b tag=review start -->第二块<!-- floatnote:ann:v2 id=b end -->\n";
    const { deps, writes } = makeDups(note);
    const tools = createNoteTools(deps);
    const del = tools.find((t) => t.name === "tag_delete")!;
    await (del as any).execute("id", { tagId: "review" });
    expect(writes[0].newContent).not.toContain("floatnote:ann:v2");
    expect(writes[0].newContent).not.toContain("floatnote:tags:v2 review");
    expect(writes[0].newContent).toContain("第一块");
    expect(writes[0].newContent).toContain("第二块");
    expect(writes[0].preview.detail.kind).toBe("tag_delete");
    expect(writes[0].preview.detail.annotationCount).toBe(2);
  });
});

describe("tag_update", () => {
  it("renames and recolors a definition without changing annotation ids", async () => {
    const note = '<!-- floatnote:tags:v2 review="复习"|c=#e5484d -->\n<!-- floatnote:ann:v2 id=a tag=review start -->正文<!-- floatnote:ann:v2 id=a end -->';
    const { deps, writes } = makeDups(note);
    const tools = createNoteTools(deps);
    const update = tools.find((t) => t.name === "tag_update")!;
    await (update as any).execute("id", { tagId: "review", name: "重点", color: "#f5a623" });
    expect(writes[0].newContent).toContain('review="重点"|c=#f5a623');
    expect(writes[0].newContent).toContain("id=a tag=review start");
    expect(writes[0].preview.detail.kind).toBe("tag_update");
  });
  it("rejects a blank name", async () => {
    const note = '<!-- floatnote:tags:v2 review="复习"|c=#e5484d -->\n正文';
    const { deps, writes } = makeDups(note);
    const update = createNoteTools(deps).find((t) => t.name === "tag_update")!;
    const r = await (update as any).execute("id", { tagId: "review", name: "   " });
    expect(r.content[0].text).toContain("不能为空");
    expect(writes).toHaveLength(0);
  });
});

describe("annotated Inbox safety", () => {
  const note = '<!-- floatnote:tags:v2 review="复习"|c=#e5484d -->\n<!-- floatnote:ann:v2 id=a tag=review start -->hello<!-- floatnote:ann:v2 id=a end --> world';

  it("read_note returns clean Markdown", async () => {
    const { deps } = makeDups(note);
    const read = createNoteTools(deps).find((tool) => tool.name === "read_note")!;
    const result = await (read as any).execute("id", { target: { kind: "inbox" } });
    expect(result.content[0].text).toBe("hello world");
  });

  it("edit_note maps annotations through a unique clean-text replacement", async () => {
    const { deps, writes } = makeDups(note);
    const edit = createNoteTools(deps).find((tool) => tool.name === "edit_note")!;
    await (edit as any).execute("id", { target: { kind: "inbox" }, old_string: " world", new_string: " brave world" });
    expect(writes[0].newContent).toContain("id=a tag=review start");
    expect(writes[0].newContent).toContain("hello<!-- floatnote:ann:v2 id=a end --> brave world");
  });

  it("write_note rejects whole-document overwrite", async () => {
    const { deps, writes } = makeDups(note);
    const write = createNoteTools(deps).find((tool) => tool.name === "write_note")!;
    const result = await (write as any).execute("id", { target: { kind: "inbox" }, content: "replacement" });
    expect(result.content[0].text).toContain("edit_note");
    expect(writes).toHaveLength(0);
  });
});
