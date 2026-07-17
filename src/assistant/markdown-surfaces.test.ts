// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPermissionDialog } from "./permission-dialog";
import { projectPermission, type PermissionRequest } from "./permission-model";
import { renderMessage } from "./render/view";

afterEach(() => document.body.replaceChildren());

function editRequest(): PermissionRequest {
  return {
    request_id: "r",
    conversation_id: "c",
    tool_name: "edit",
    operation: "edit",
    old_content: "# Before",
    new_content: "# After\n\n| A | B |\n| --- | --- |\n| 1 | 2 |",
    preview: { tool: "edit", summary: "", detail: { kind: "diff", hunks: "" } },
    can_snapshot: false,
    resolved_path: "/notes/piece.md",
  };
}

describe("Markdown surfaces", () => {
  it("renders Markdown in user messages", () => {
    const message = renderMessage({ id: "u", role: "user", text: "> quoted\n\n`code`" });

    expect(message.querySelector(".chat-user-message-text blockquote")?.textContent).toBe("quoted");
    expect(message.querySelector(".chat-user-message-text code")?.textContent).toBe("code");
    expect(message.querySelector(".chat-user-message-text")?.classList.contains("fn-markdown")).toBe(true);
  });

  it("switches edit review between source diff and rendered new-version preview", () => {
    const req = editRequest();
    const dialog = createPermissionDialog({ onResolve: vi.fn(), onClose: vi.fn() });
    dialog.open(req, projectPermission(req));

    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("对比");
    expect(document.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(
      document.querySelector('[role="tab"][aria-selected="true"]')?.id,
    );
    expect(document.querySelector(".perm-diff")).not.toBeNull();

    document.querySelector<HTMLButtonElement>('[role="tab"]:last-child')!.click();

    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("新版本");
    expect(document.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(
      document.querySelector('[role="tab"][aria-selected="true"]')?.id,
    );
    expect(document.querySelector(".perm-dialog-markdown table")?.textContent).toContain("1");
    expect(document.querySelector(".perm-diff")).toBeNull();
  });

  it("supports arrow-key navigation between review tabs", () => {
    const req = editRequest();
    const dialog = createPermissionDialog({ onResolve: vi.fn(), onClose: vi.fn() });
    dialog.open(req, projectPermission(req));
    const diffTab = document.querySelector<HTMLButtonElement>('[role="tab"]')!;

    diffTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("新版本");
    expect(document.activeElement?.textContent).toBe("新版本");
    expect(document.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(document.activeElement?.id);
  });

  it("renders create review directly without an empty tab row", () => {
    const req = editRequest();
    req.tool_name = "create_piece";
    req.operation = "create";
    req.old_content = "";
    req.preview = { tool: "create_piece", summary: "", detail: { kind: "note_create", filename: "piece.md", contentPreview: "" } };
    const dialog = createPermissionDialog({ onResolve: vi.fn(), onClose: vi.fn() });
    dialog.open(req, projectPermission(req));

    expect(document.querySelector(".perm-review-tabs")).toBeNull();
    expect(document.querySelector(".perm-dialog-body")?.classList.contains("has-tabs")).toBe(false);
    expect(document.querySelector(".perm-dialog-markdown h1")?.textContent).toBe("After");
  });
});
