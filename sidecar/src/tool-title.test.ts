import { describe, expect, it } from "vitest";
import { formatToolTitle, sanitizeToolError } from "./tool-title.js";

describe("formatToolTitle", () => {
  it.each([
    ["read_note", { target: { kind: "tasks" } }, "读取 行动清单"],
    ["write_note", { target: { kind: "inbox" }, content: "secret" }, "编辑 采集区"],
    ["edit_note", { target: { kind: "piece", name: "piece.md" }, old_string: "secret" }, "编辑 piece.md"],
    ["create_note", { title: "Ideas" }, "创建 Ideas.md"],
    ["read_note", {}, "读取当前文档"],
    ["tag_text", { exact: "第一行\n后续正文", tagName: "行动" }, "给“第一行 后续正文”设置标签"],
    ["read_skill", { name: "brainstorming" }, "读取技能 brainstorming"],
    ["web_search", { query: "FloatNote Tauri" }, "搜索网页 FloatNote Tauri"],
    ["web_fetch", { url: "https://example.com/a?secret=1" }, "读取网页 example.com"],
  ])("formats %s safely", (name, args, expected) => {
    expect(formatToolTitle(name, args)).toBe(expected);
  });

  it("falls back to a stable unknown tool name without exposing body arguments", () => {
    expect(formatToolTitle("custom_tool", { content: "private body" })).toBe("custom_tool");
  });
});

describe("sanitizeToolError", () => {
  it("keeps only a short single-line reason", () => {
    expect(sanitizeToolError("permission denied\nfull response body")).toBe("permission denied");
    expect(sanitizeToolError({ content: [{ type: "text", text: "network denied\nresponse body" }] })).toBe("network denied");
  });
});
