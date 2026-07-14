// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPermissionDialog } from "./permission-dialog";
import { projectPermission, type PermissionRequest } from "./permission-model";

afterEach(() => document.body.replaceChildren());

function request(): PermissionRequest {
  return {
    request_id: "r", conversation_id: "c", tool_name: "edit_note",
    old_content: "a\nb\nc", new_content: "a\ninserted\nb\nc",
    preview: { tool: "edit_note", summary: "", detail: { kind: "diff", hunks: "bad alignment" } },
    can_snapshot: false, resolved_path: "/notes/piece.md",
  };
}

describe("permission dialog", () => {
  it("renders aligned side-by-side line rows from complete old and new content", () => {
    const req = request();
    const dialog = createPermissionDialog({ onResolve: vi.fn(), onClose: vi.fn() });
    dialog.open(req, projectPermission(req));
    expect([...document.querySelectorAll(".perm-diff-row")].map((row) => row.textContent)).toEqual(["aa", "inserted", "bb", "cc"]);
    expect(document.querySelector(".perm-diff-old-label")?.textContent).toBe("原版本");
    expect(document.querySelector(".perm-diff-new-label")?.textContent).toBe("新版本");
  });

  it("expands folded unchanged context in place", () => {
    const req = request();
    req.old_content = ["0", "1", "2", "3", "4", "5", "old", "7"].join("\n");
    req.new_content = ["0", "1", "2", "3", "4", "5", "new", "7"].join("\n");
    const dialog = createPermissionDialog({ onResolve: vi.fn(), onClose: vi.fn() });
    dialog.open(req, projectPermission(req));
    const collapsed = document.querySelector<HTMLButtonElement>(".perm-diff-collapsed")!;
    expect(collapsed.textContent).toContain("省略");
    collapsed.click();
    expect(document.querySelector(".perm-diff-collapsed")).toBeNull();
    expect(document.querySelector(".perm-diff")?.textContent).toContain("0");
  });
});
