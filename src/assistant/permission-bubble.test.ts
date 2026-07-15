// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { mountPermissionBubble, type PermissionRequest } from "./permission-bubble";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

function request(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    request_id: "req-1", conversation_id: "conv-1", tool_name: "create_note",
    old_content: "", new_content: "# Full document\n\nComplete body",
    preview: { tool: "create_note", summary: "duplicate summary", detail: { kind: "note_create", filename: "Ideas.md", contentPreview: "# Short" } },
    can_snapshot: false, resolved_path: "/notes/Ideas.md", ...overrides,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.mocked(invoke).mockClear();
});

describe("permission bubble", () => {
  it("renders exactly a semantic title row and a footer with ordered controls", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root, vi.fn());
    bubble.show(request());
    expect(root.querySelector(".perm-title")?.textContent).toBe("创建「Ideas.md」");
    expect(root.textContent).not.toContain("duplicate summary");
    expect(root.textContent).not.toContain("Complete body");
    expect([...root.querySelectorAll(".perm-footer button")].map((button) => button.textContent?.trim())).toEqual(["查看", "拒绝", "允许写入"]);
  });

  it("opens the complete create preview and closes without resolving", () => {
    const root = document.createElement("div");
    const resolve = vi.fn();
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root, resolve);
    bubble.show(request());
    root.querySelector<HTMLButtonElement>(".perm-view")!.click();
    expect(document.querySelector(".perm-dialog-markdown h1")?.textContent).toBe("Full document");
    expect(document.querySelector(".perm-dialog")?.textContent).toContain("Complete body");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(resolve).not.toHaveBeenCalled();
    expect(bubble.isOpen()).toBe(true);
  });
  it("submits only the first decision and disables compact and dialog controls together", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const resolve = vi.fn(() => pending);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root, resolve);
    bubble.show(request({ tool_name: "write_note", can_snapshot: true, preview: { tool: "write_note", summary: "", detail: { kind: "diff", hunks: "" } } }));
    root.querySelector<HTMLButtonElement>(".perm-view")!.click();
    root.querySelector<HTMLButtonElement>(".perm-allow-main")!.click();
    root.querySelector<HTMLButtonElement>(".perm-deny")!.click();
    expect(resolve).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ request_id: "req-1" }), "allow", "direct");
    expect([...document.querySelectorAll<HTMLButtonElement>(".perm-dialog button")].every((button) => button.disabled)).toBe(true);
    finish();
    await pending;
    await Promise.resolve();
    expect(bubble.isOpen()).toBe(false);
  });

  it("re-enables the pending request and reports resolution failures", async () => {
    const root = document.createElement("div");
    const onError = vi.fn();
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root, vi.fn().mockRejectedValue(new Error("io")), onError);
    bubble.show(request());
    root.querySelector<HTMLButtonElement>(".perm-allow-main")!.click();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
    expect(root.querySelector<HTMLButtonElement>(".perm-allow-main")?.disabled).toBe(false);
    expect(bubble.isOpen()).toBe(true);
  });

  it("sends the exact snapshot invoke payload without a second confirmation", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root);
    bubble.show(request({ tool_name: "write_note", can_snapshot: true, preview: { tool: "write_note", summary: "", detail: { kind: "diff", hunks: "" } } }));
    root.querySelector<HTMLButtonElement>(".perm-allow-arrow")!.click();
    document.querySelector<HTMLButtonElement>(".fn-menu__item")!.click();
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("resolve_permission", {
      requestId: "req-1", decision: "allow", writeMode: "snapshot",
    });
    await vi.waitFor(() => expect(bubble.isOpen()).toBe(false));
  });
});
