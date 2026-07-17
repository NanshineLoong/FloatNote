import { describe, expect, it } from "vitest";
import { formatToolPresentation, formatToolTitle, sanitizeToolError } from "./tool-title.js";

describe("formatToolTitle", () => {
  it.each([
    ["ls", {}, "列出项目文档"],
    ["read", { path: "_tasks.md" }, "读取 行动清单"],
    ["write", { path: "_inbox.md", content: "secret" }, "写入 采集区"],
    ["create_piece", { title: "AI 内化 Tutor 的想法", content: "secret" }, "创建 AI 内化 Tutor 的想法"],
    ["edit", { path: "piece.md", edits: [{ oldText: "secret", newText: "safe" }] }, "编辑 piece.md"],
    ["find", { pattern: "*.md" }, "查找文档 *.md"],
    ["grep", { pattern: "计划" }, "搜索文档 计划"],
    ["read", {}, "读取文档"],
    ["tag_text", { exact: "第一行\n后续正文", tagName: "行动" }, "给“第一行 后续正文”设置标签"],
    ["web_search", { query: "FloatNote Tauri" }, "搜索网页 FloatNote Tauri"],
    ["web_fetch", { url: "https://example.com/a?secret=1" }, "获取网页 example.com"],
  ])("formats %s safely", (name, args, expected) => {
    expect(formatToolTitle(name, args)).toBe(expected);
  });

  it("falls back to a stable unknown tool name without exposing body arguments", () => {
    expect(formatToolTitle("custom_tool", { content: "private body" })).toBe("custom_tool");
  });
});

describe("formatToolPresentation", () => {
  it.each([
    ["ls", {}, "document_list", "列出项目文档"],
    ["read", { path: "piece.md" }, "document_read", "读取 piece.md"],
    ["read", { path: "/Users/me/.floatnote/skills/brainstorming/SKILL.md" }, "skill", "读取技能 brainstorming"],
    ["read", { path: "C:\\Users\\me\\skills\\socratic-review\\SKILL.md" }, "skill", "读取技能 socratic-review"],
    ["find", { pattern: "*.md" }, "document_find", "查找文档 *.md"],
    ["grep", { pattern: "计划" }, "document_search", "搜索文档 计划"],
    ["edit", { path: "piece.md" }, "document_write", "编辑 piece.md"],
    ["write", { path: "piece.md" }, "document_write", "写入 piece.md"],
    ["create_piece", { title: "新想法" }, "document_create", "创建 新想法"],
    ["list_tags", {}, "tag", "列出标签"],
    ["tag_text", { exact: "一段文字" }, "tag", "给“一段文字”设置标签"],
    ["tag_create", { name: "行动" }, "tag", "新建标签 行动"],
    ["tag_update", { name: "行动" }, "tag", "修改标签 行动"],
    ["tag_delete", { name: "稍后" }, "tag", "删除标签 稍后"],
    ["web_search", { query: "FloatNote Tauri" }, "web_search", "搜索网页 FloatNote Tauri"],
    ["web_fetch", { url: "https://example.com/a?secret=1" }, "web_fetch", "获取网页 example.com"],
    ["custom_tool", { content: "secret" }, "other", "custom_tool"],
  ])("classifies %s as %s with a safe label", (name, args, category, label) => {
    expect(formatToolPresentation(name, args)).toEqual({ category, label });
  });
});

describe("sanitizeToolError", () => {
  it("keeps only a short single-line reason", () => {
    expect(sanitizeToolError("permission denied\nfull response body")).toBe("permission denied");
    expect(sanitizeToolError({ content: [{ type: "text", text: "network denied\nresponse body" }] })).toBe("network denied");
  });
});
