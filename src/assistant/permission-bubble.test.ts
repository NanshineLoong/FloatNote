// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { mountPermissionBubble, TOOL_LABEL, type PermissionRequest } from "./permission-bubble";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

function request(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    request_id: "req-1", conversation_id: "conv-1", tool_name: "create_piece", operation: "create",
    old_content: "", new_content: "# Full document\n\nComplete body",
    preview: { tool: "create_piece", summary: "duplicate summary", detail: { kind: "note_create", filename: "Ideas.md", contentPreview: "# Short" } },
    can_snapshot: false, resolved_path: "/notes/Ideas.md", ...overrides,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.mocked(invoke).mockClear();
});

describe("permission bubble", () => {
  it("exposes only the new FloatNote tool labels", () => {
    expect(TOOL_LABEL).toMatchObject({
      ls: "列出笔记",
      read: "读取文档",
      find: "查找文档",
      grep: "搜索文档",
      edit: "编辑文本",
      write: "写入文档",
    });
    expect(TOOL_LABEL).not.toHaveProperty("read_note");
  });

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

  it("discloses the complete tag target without moving decision controls into the scroll surface", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root, vi.fn());
    const targetText = `第一行\n${"超过八十字符的完整目标".repeat(12)}`;
    bubble.show(request({
      tool_name: "tag_text",
      operation: "tag",
      preview: { tool: "tag_text", summary: "", detail: { kind: "tag_assign", textExcerpt: targetText.slice(0, 80), targetText, annotationCount: 1, action: "add", tagName: "重点", tagColor: "#e5484d" } },
    }));

    expect(root.querySelector(".perm-title")?.textContent).toBe("添加标签「重点」");
    expect(root.querySelector(".perm-tag-target-compact")?.textContent).toContain(targetText.slice(0, 80));
    const disclosure = root.querySelector<HTMLButtonElement>(".perm-tag-disclosure")!;
    expect(disclosure.textContent).toBe("展开");
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");

    disclosure.click();

    const surface = root.querySelector<HTMLElement>(".perm-tag-target-full")!;
    expect(surface.textContent).toBe(targetText);
    expect(surface.getAttribute("aria-label")).toBe("标签“重点”的目标文本全文");
    expect(disclosure.textContent).toBe("收起");
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(surface.contains(root.querySelector(".perm-footer-actions"))).toBe(false);
    expect(document.activeElement).toBe(disclosure);
  });

  it("labels a legacy tag target as available text instead of claiming it is complete", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root, vi.fn());
    bubble.show(request({
      tool_name: "tag_text",
      operation: "tag",
      preview: { tool: "tag_text", summary: "", detail: { kind: "tag_assign", textExcerpt: "旧请求摘要", annotationCount: 1, action: "remove", tagName: "重点", tagColor: "#e5484d" } },
    }));

    root.querySelector<HTMLButtonElement>(".perm-tag-disclosure")!.click();

    expect(root.querySelector(".perm-tag-target-heading")?.textContent).toBe("目标文本 · 可用文本");
    expect(root.querySelector(".perm-tag-target-full")?.getAttribute("aria-label")).toContain("可用文本");
  });

  it("resets tag disclosure for the next request and disables it while resolving", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const root = document.createElement("div");
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root, vi.fn(() => pending));
    const tagRequest = (id: string, tagName: string): PermissionRequest => request({
      request_id: id,
      tool_name: "tag_text",
      operation: "tag",
      preview: { tool: "tag_text", summary: "", detail: { kind: "tag_assign", textExcerpt: "摘要", targetText: "完整目标", annotationCount: 1, action: "add", tagName, tagColor: "#e5484d" } },
    });
    bubble.show(tagRequest("req-1", "重点"));
    bubble.show(tagRequest("req-2", "复习"));
    root.querySelector<HTMLButtonElement>(".perm-tag-disclosure")!.click();
    root.querySelector<HTMLButtonElement>(".perm-allow-main")!.click();

    expect(root.querySelector<HTMLButtonElement>(".perm-tag-disclosure")!.disabled).toBe(true);
    finish();
    await pending;
    await Promise.resolve();
    expect(root.querySelector(".perm-title")?.textContent).toBe("添加标签「复习」");
    expect(root.querySelector(".perm-tag-target-full")).toBeNull();
    expect(root.querySelector<HTMLButtonElement>(".perm-tag-disclosure")?.getAttribute("aria-expanded")).toBe("false");
  });
  it("submits only the first decision and disables compact and dialog controls together", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const resolve = vi.fn(() => pending);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root, resolve);
    bubble.show(request({ tool_name: "write", operation: "rewrite", can_snapshot: true, preview: { tool: "write", summary: "", detail: { kind: "diff", hunks: "" } } }));
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

  it("queues concurrent requests and advances only after the current request resolves", async () => {
    let finishFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { finishFirst = resolve; });
    const resolve = vi.fn((req: PermissionRequest) => req.request_id === "req-1" ? firstPending : Promise.resolve());
    const root = document.createElement("div");
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root, resolve);

    bubble.show(request({ request_id: "req-1", resolved_path: "/notes/First.md" }));
    root.querySelector<HTMLButtonElement>(".perm-allow-main")!.click();
    bubble.show(request({ request_id: "req-2", resolved_path: "/notes/Second.md" }));

    expect(root.querySelector(".perm-title")?.textContent).toBe("创建「First.md」");
    finishFirst();
    await firstPending;
    await Promise.resolve();
    expect(root.querySelector(".perm-title")?.textContent).toBe("创建「Second.md」");

    root.querySelector<HTMLButtonElement>(".perm-allow-main")!.click();
    await vi.waitFor(() => expect(bubble.isOpen()).toBe(false));
    expect(resolve.mock.calls.map(([req]) => req.request_id)).toEqual(["req-1", "req-2"]);
  });

  it("clears a resolved request by id without dismissing a newer request", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root, vi.fn());
    bubble.show(request({ request_id: "req-1", resolved_path: "/notes/First.md" }));
    bubble.show(request({ request_id: "req-2", resolved_path: "/notes/Second.md" }));

    bubble.clear("req-1");

    expect(root.querySelector(".perm-title")?.textContent).toBe("创建「Second.md」");
    expect(bubble.isOpen()).toBe(true);
  });

  it("denies every queued request when the permission controller is destroyed", async () => {
    const resolve = vi.fn().mockResolvedValue(undefined);
    const root = document.createElement("div");
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root, resolve);
    bubble.show(request({ request_id: "req-1" }));
    bubble.show(request({ request_id: "req-2" }));

    bubble.destroy();

    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    expect(resolve.mock.calls.map(([req, decision]) => [req.request_id, decision])).toEqual([
      ["req-1", "deny"],
      ["req-2", "deny"],
    ]);
  });

  it("does not deny the current request again when its decision is already in flight", async () => {
    const resolve = vi.fn((_req: PermissionRequest, _decision: "allow" | "deny") => new Promise<void>(() => {}));
    const root = document.createElement("div");
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root, resolve);
    bubble.show(request({ request_id: "req-1" }));
    root.querySelector<HTMLButtonElement>(".perm-allow-main")!.click();
    bubble.show(request({ request_id: "req-2" }));

    bubble.destroy();

    await vi.waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    expect(resolve.mock.calls.map(([req, decision]) => [req.request_id, decision])).toEqual([
      ["req-1", "allow"],
      ["req-2", "deny"],
    ]);
  });

  it("sends the exact snapshot invoke payload without a second confirmation", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const bubble = mountPermissionBubble(root);
    bubble.show(request({ tool_name: "write", operation: "rewrite", can_snapshot: true, preview: { tool: "write", summary: "", detail: { kind: "diff", hunks: "" } } }));
    root.querySelector<HTMLButtonElement>(".perm-allow-arrow")!.click();
    document.querySelector<HTMLButtonElement>(".fn-menu__item")!.click();
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("resolve_permission", {
      requestId: "req-1", decision: "allow", writeMode: "snapshot",
    });
    await vi.waitFor(() => expect(bubble.isOpen()).toBe(false));
  });
});
