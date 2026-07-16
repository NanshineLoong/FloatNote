// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPermissionDialog } from "./permission-dialog";
import { projectPermission, type PermissionRequest } from "./permission-model";

afterEach(() => document.body.replaceChildren());

function request(): PermissionRequest {
  return {
    request_id: "r", conversation_id: "c", tool_name: "edit", operation: "edit",
    old_content: "a\nb\nc", new_content: "a\ninserted\nb\nc",
    preview: { tool: "edit", summary: "", detail: { kind: "diff", hunks: "bad alignment" } },
    can_snapshot: false, resolved_path: "/notes/piece.md",
  };
}

describe("permission dialog", () => {
  it("renders wide and unified views from the same complete line diff", () => {
    const req = request();
    const dialog = createPermissionDialog({ onResolve: vi.fn(), onClose: vi.fn() });
    dialog.open(req, projectPermission(req));
    expect([...document.querySelectorAll(".perm-diff-wide .perm-diff-row")].map((row) => row.textContent)).toEqual(["aa", "inserted", "bb", "cc"]);
    expect(document.querySelector(".perm-diff-old-label")?.textContent).toBe("原版本");
    expect(document.querySelector(".perm-diff-new-label")?.textContent).toBe("新版本");
    expect([...document.querySelectorAll(".perm-diff-unified .perm-diff-unified-row")].map((row) => [
      row.querySelector(".perm-diff-marker")?.textContent,
      row.querySelector(".perm-diff-unified-content")?.textContent,
    ])).toEqual([
      [" ", "a"], ["+", "inserted"], [" ", "b"], [" ", "c"],
    ]);
    expect(document.querySelector(".perm-review-panel")?.classList.contains("perm-review-container")).toBe(true);
  });

  it("expands folded unchanged context in place", () => {
    const req = request();
    req.old_content = ["0", "1", "2", "3", "4", "5", "old", "7"].join("\n");
    req.new_content = ["0", "1", "2", "3", "4", "5", "new", "7"].join("\n");
    const dialog = createPermissionDialog({ onResolve: vi.fn(), onClose: vi.fn() });
    dialog.open(req, projectPermission(req));
    const collapsed = document.querySelector<HTMLButtonElement>(".perm-diff-wide .perm-diff-collapsed")!;
    expect(collapsed.textContent).toContain("省略");
    collapsed.click();
    expect(document.querySelector(".perm-diff-collapsed")).toBeNull();
    expect(document.querySelector(".perm-diff")?.textContent).toContain("0");
  });

  it("renders replacement rows as removal followed by addition in unified mode", () => {
    const req = request();
    req.old_content = "same\nold value";
    req.new_content = "same\nnew value";
    const dialog = createPermissionDialog({ onResolve: vi.fn(), onClose: vi.fn() });
    dialog.open(req, projectPermission(req));

    expect([...document.querySelectorAll(".perm-diff-unified-row")].map((row) => [
      row.className,
      row.querySelector(".perm-diff-marker")?.textContent,
      row.querySelector(".perm-diff-unified-content")?.textContent,
    ])).toEqual([
      [expect.stringContaining("is-unchanged"), " ", "same"],
      [expect.stringContaining("is-removed"), "−", "old value"],
      [expect.stringContaining("is-added"), "+", "new value"],
    ]);
    expect([...document.querySelectorAll(".perm-diff-status")].map((status) => status.textContent)).toEqual([
      "未修改行：", "修改前行：", "修改后行：",
    ]);
  });
});
