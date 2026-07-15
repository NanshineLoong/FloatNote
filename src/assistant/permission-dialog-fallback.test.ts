// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./permission-diff", async (importOriginal) => {
  const original = await importOriginal<typeof import("./permission-diff")>();
  return {
    ...original,
    buildDiffRows: () => { throw new Error("diff failed"); },
  };
});

import { createPermissionDialog } from "./permission-dialog";
import { projectPermission, type PermissionRequest } from "./permission-model";

afterEach(() => document.body.replaceChildren());

describe("permission dialog diff fallback", () => {
  it("offers a responsive unified escaped-text fallback when diff construction fails", () => {
    const request: PermissionRequest = {
      request_id: "fallback",
      conversation_id: "conversation",
      tool_name: "write_note",
      old_content: "<old>\nline two",
      new_content: "<new>\nline two",
      preview: { tool: "write_note", summary: "", detail: { kind: "diff", hunks: "" } },
      can_snapshot: false,
    };
    const dialog = createPermissionDialog({ onResolve: vi.fn(), onClose: vi.fn() });

    dialog.open(request, projectPermission(request));

    expect(document.querySelector(".perm-diff-fallback")).not.toBeNull();
    const unified = document.querySelector(".perm-diff-fallback-unified");
    expect(unified?.getAttribute("aria-label")).toBe("统一文本对比");
    expect(unified?.textContent).toContain("− <old>");
    expect(unified?.textContent).toContain("+ <new>");
    expect(unified?.querySelector("old")).toBeNull();
  });
});
