import { describe, expect, it } from "vitest";
import { projectPermission } from "./permission-model";
import type { PermissionRequest } from "./permission-bubble";

function request(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    request_id: "req-1",
    conversation_id: "conv-1",
    tool_name: "edit_note",
    old_content: "old",
    new_content: "new",
    preview: { tool: "edit_note", summary: "ignored", detail: { kind: "diff", hunks: "" } },
    can_snapshot: false,
    ...overrides,
  };
}

describe("projectPermission", () => {
  it.each([
    ["create_note", "创建「Ideas.md」", true],
    ["edit_note", "编辑「piece.md」", true],
    ["write_note", "覆写「piece.md」", true],
  ])("projects %s document title", (tool, title, canView) => {
    const result = projectPermission(request({
      tool_name: tool,
      resolved_path: tool === "create_note" ? "C:\\notes\\Ideas.md" : "/notes/piece.md",
      preview: tool === "create_note"
        ? { tool, summary: "ignored", detail: { kind: "note_create", filename: "fallback.md", contentPreview: "short" } }
        : { tool, summary: "ignored", detail: { kind: "diff", hunks: "" } },
    }));
    expect(result.title).toBe(title);
    expect(result.canView).toBe(canView);
  });

  it("uses target, resolved note id, then the generic document fallback", () => {
    expect(projectPermission(request({ target: { kind: "piece", name: "target.md" } })).title).toContain("target.md");
    expect(projectPermission(request({ resolved_note_id: "resolved.md" })).title).toContain("resolved.md");
    expect(projectPermission(request()).title).toContain("当前文档");
  });

  it("projects tag operations without exposing raw markers", () => {
    const assign = projectPermission(request({
      tool_name: "set_tag",
      preview: { tool: "set_tag", summary: "", detail: { kind: "tag_assign", blockPreview: "块摘要", tagName: "重点", tagColor: "#f00" } },
    }));
    expect(assign.title).toBe("为「块摘要」设置标签「重点」");
    expect(assign.colors).toEqual([{ label: "重点", color: "#f00" }]);

    const clear = projectPermission(request({
      tool_name: "set_tag",
      preview: { tool: "set_tag", summary: "", detail: { kind: "tag_assign", blockPreview: "块摘要", tagName: "", tagColor: "" } },
    }));
    expect(clear.title).toBe("清除「块摘要」的标签");
  });

  it("projects create, update, and delete tag titles with color cues", () => {
    const create = projectPermission(request({ tool_name: "tag_create", preview: { tool: "tag_create", summary: "", detail: { kind: "tag_create", tagName: "重点", tagColor: "#f00" } } }));
    expect(create).toMatchObject({ title: "新建标签「重点」", canView: false });
    expect(create.colors).toHaveLength(1);
    const update = projectPermission(request({ tool_name: "tag_update", preview: { tool: "tag_update", summary: "", detail: { kind: "tag_update", tagId: "x", oldName: "旧", oldColor: "#111", newName: "新", newColor: "#222" } } }));
    expect(update.title).toBe("修改标签「旧」→「新」");
    expect(update.colors).toHaveLength(2);
    const remove = projectPermission(request({ tool_name: "tag_delete", preview: { tool: "tag_delete", summary: "", detail: { kind: "tag_delete", tagName: "重点", markerCount: 3 } } }));
    expect(remove.title).toBe("删除标签「重点」并清除 3 处标记");
  });

  it("only enables snapshot split approval for snapshot-capable write_note", () => {
    expect(projectPermission(request({ tool_name: "write_note", can_snapshot: true })).canSnapshot).toBe(true);
    expect(projectPermission(request({ tool_name: "edit_note", can_snapshot: true })).canSnapshot).toBe(false);
  });
});
