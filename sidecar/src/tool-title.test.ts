import { describe, expect, it } from "vitest";
import { formatToolTitle, sanitizeToolError } from "./tool-title.js";

describe("formatToolTitle", () => {
  it.each([
    ["ls", {}, "列出笔记"],
    ["read", { path: "_tasks.md" }, "读取 行动清单"],
    ["write", { path: "_inbox.md", content: "secret" }, "写入 采集区"],
    ["edit", { path: "piece.md", edits: [{ oldText: "secret", newText: "safe" }] }, "编辑 piece.md"],
    ["find", { pattern: "*.md" }, "查找文档 *.md"],
    ["grep", { pattern: "计划" }, "搜索文档 计划"],
    ["read", {}, "读取文档"],
    ["tag_text", { exact: "第一行\n后续正文", tagName: "行动" }, "给“第一行 后续正文”设置标签"],
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
