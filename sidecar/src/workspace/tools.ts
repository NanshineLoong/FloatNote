import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { normalizeWorkspaceRoot, validateProjectPath } from "./path-policy.js";
import { filterPaths, searchDocuments } from "./search.js";
import type { WorkspaceClient } from "./types.js";

export interface ReadOnlyWorkspaceToolDeps {
  workspace: WorkspaceClient;
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function positiveLimit(value: number | undefined, fallback: number, max: number): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > max) {
    throw new Error(`limit 必须在 1..${max} 之间`);
  }
  return resolved;
}

export function createReadOnlyWorkspaceTools(deps: ReadOnlyWorkspaceToolDeps): ToolDefinition[] {
  const ls = defineTool({
    name: "ls",
    label: "List",
    description: "列出当前已由 FloatNote 选定的平面项目及其笔记标识。返回的笔记 path 相对于当前项目，不包含项目名称。",
    parameters: Type.Object({
      path: Type.Optional(Type.String({ description: "Workspace root to list; omit or use '.'" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of entries to return (default: 500)" })),
    }),
    async execute(_toolCallId, input: { path?: string; limit?: number }) {
      normalizeWorkspaceRoot(input.path);
      const limit = positiveLimit(input.limit, 500, 1000);
      const entries = await deps.workspace.listEntries();
      return textResult(JSON.stringify({
        workspace: {
          kind: "floatnote_project",
          layout: "flat",
          addressing: "note identifiers are relative to this already-selected project",
        },
        notes: entries.slice(0, limit),
        ...(entries.length > limit ? { truncatedAt: limit } : {}),
      }, null, 2));
    },
  });

  const find = defineTool({
    name: "find",
    label: "Find",
    description: "按 glob 查找当前 FloatNote 项目中的笔记路径。",
    parameters: Type.Object({
      pattern: Type.String({ description: "Glob pattern to match notes, e.g. '*.md'" }),
      path: Type.Optional(Type.String({ description: "Workspace root to search; omit or use '.'" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
    }),
    async execute(_toolCallId, input: { pattern: string; path?: string; limit?: number }) {
      normalizeWorkspaceRoot(input.path);
      const limit = positiveLimit(input.limit, 1000, 1000);
      const entries = await deps.workspace.listEntries();
      const matches = filterPaths(entries.map((entry) => entry.path), input.pattern);
      const lines = matches.slice(0, limit);
      if (matches.length > limit) lines.push(`[Results truncated at ${limit} entries]`);
      return textResult(lines.join("\n"));
    },
  });

  const read = defineTool({
    name: "read",
    label: "Read",
    description: "读取当前 FloatNote 项目笔记或可用 Skill 资源。读取 Inbox 时返回干净 Markdown，并附带只读的标签与引用来源上下文。",
    parameters: Type.Object({
      path: Type.String({ description: "当前项目中的笔记路径，或 <available_skills> 中列出的 Skill 资源路径" }),
      offset: Type.Optional(Type.Number({ description: "Line number to start reading from (1-indexed)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
    }),
    async execute(_toolCallId, input: { path: string; offset?: number; limit?: number }) {
      const projected = await deps.workspace.read(input);
      const content = [{ type: "text" as const, text: projected.markdown }];
      if (projected.context) content.push({ type: "text" as const, text: projected.context });
      if (projected.nextOffset) {
        content.push({
          type: "text" as const,
          text: `[More lines available. Continue with offset=${projected.nextOffset}]`,
        });
      }
      return { content, details: { totalLines: projected.totalLines, nextOffset: projected.nextOffset } };
    },
  });

  const grep = defineTool({
    name: "grep",
    label: "Grep",
    description: "在当前项目笔记的可见 Markdown 中搜索内容，返回匹配行、笔记路径和行号。",
    parameters: Type.Object({
      pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
      path: Type.Optional(Type.String({ description: "Workspace root or listed note to search (default: current workspace)" })),
      glob: Type.Optional(Type.String({ description: "Filter notes by glob pattern, e.g. '*.md'" })),
      ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
      literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" })),
      context: Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })),
      limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
    }),
    async execute(_toolCallId, input: {
      pattern: string;
      path?: string;
      glob?: string;
      ignoreCase?: boolean;
      literal?: boolean;
      context?: number;
      limit?: number;
    }) {
      const entries = await deps.workspace.listEntries();
      let paths: string[];
      if (input.path === undefined || input.path === "" || input.path === ".") {
        paths = entries.map((entry) => entry.path);
      } else {
        paths = [validateProjectPath(input.path, entries.map((entry) => entry.path))];
      }
      if (input.glob) paths = filterPaths(paths, input.glob);
      const documents = await Promise.all(paths.map(async (notePath) => ({
        path: notePath,
        content: await deps.workspace.readCleanProject(notePath),
      })));
      return textResult(searchDocuments(documents, input).text);
    },
  });

  return [ls, read, find, grep];
}
