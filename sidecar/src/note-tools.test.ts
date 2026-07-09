import { describe, it, expect, vi } from "vitest";
import { createNoteTools, type NoteToolDeps } from "./note-tools.js";
import type { NoteTarget, EditPreview } from "./protocol.js";

function makeDups(noteText: string): { deps: NoteToolDeps; writes: any[] } {
  const writes: any[] = [];
  const deps: NoteToolDeps = {
    getNoteText: async () => noteText,
    requestWrite: async (args) => {
      writes.push(args);
      return { ok: true, version: 1 };
    },
  };
  return { deps, writes };
}

const inbox: NoteTarget = { kind: "inbox" };

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
