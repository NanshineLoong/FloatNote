// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderPreviewCard } from "./permission-bubble.js";

describe("renderPreviewCard", () => {
  it("renders diff card for edit_note", () => {
    const el = renderPreviewCard({ tool: "edit_note", summary: "s", detail: { kind: "diff", hunks: "- a\n+ b" } }, true);
    expect(el.textContent).toContain("编辑文本");
    expect(el.querySelector("pre")?.textContent).toContain("- a");
  });
  it("shows snapshot option only when can_snapshot", () => {
    const withSnap = renderPreviewCard({ tool: "edit_note", summary: "s", detail: { kind: "diff", hunks: "x" } }, true);
    const noSnap = renderPreviewCard({ tool: "edit_note", summary: "s", detail: { kind: "diff", hunks: "x" } }, false);
    expect(withSnap.querySelector("option[value='snapshot']")).toBeTruthy();
    expect(noSnap.querySelector("option[value='snapshot']")).toBeNull();
  });
  it("renders tag_assign card without raw marker", () => {
    const el = renderPreviewCard({ tool: "set_tag", summary: "s", detail: { kind: "tag_assign", blockPreview: "第一块", tagName: "review", tagColor: "#e5484d" } }, false);
    expect(el.textContent).toContain("review");
    expect(el.textContent).not.toContain("floatnote:tag");
  });
  it("renders note creation and tag update semantic cards", () => {
    const create = renderPreviewCard({ tool: "create_note", summary: "创建", detail: { kind: "note_create", filename: "Ideas.md", contentPreview: "first line" } }, false);
    expect(create.textContent).toContain("Ideas.md");
    expect(create.textContent).toContain("first line");
    const update = renderPreviewCard({ tool: "tag_update", summary: "修改", detail: { kind: "tag_update", tagId: "review", oldName: "复习", oldColor: "#e5484d", newName: "重点", newColor: "#f5a623" } }, false);
    expect(update.textContent).toContain("复习");
    expect(update.textContent).toContain("重点");
  });
});
