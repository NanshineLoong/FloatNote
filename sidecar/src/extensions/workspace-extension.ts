import {
  defineTool,
  type InlineExtension,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { MutationCoordinator } from "../workspace/mutation-coordinator.js";
import { createReadOnlyWorkspaceTools } from "../workspace/tools.js";
import type { WorkspaceClient } from "../workspace/types.js";

function mutationResult(result: { ok: boolean; version?: number; path: string; operation: string }) {
  const text = result.operation === "create"
    ? `已创建 ${result.path}`
    : result.version ? `已更新 ${result.path}，版本 v${result.version}` : `已更新 ${result.path}`;
  return { content: [{ type: "text" as const, text }], details: { path: result.path, operation: result.operation } };
}

export function createWorkspaceTools(
  workspace: WorkspaceClient,
  coordinator: MutationCoordinator,
): ToolDefinition[] {
  const edit = defineTool({
    name: "edit",
    label: "Edit",
    description: "对同一份原始文档执行一个或多个唯一、互不重叠的精确替换。编辑 Inbox 时，FloatNote 会保留并映射文本标注与引用来源。",
    parameters: Type.Object({
      path: Type.String({ description: "ls/find 返回的当前项目根级笔记标识；目标必须已经存在" }),
      edits: Type.Array(Type.Object({
        oldText: Type.String({ description: "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call." }),
        newText: Type.String({ description: "Replacement text for this targeted edit." }),
      }), {
        description: "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead.",
      }),
    }),
    executionMode: "sequential",
    async execute(toolCallId) {
      return mutationResult(await coordinator.commitForTool(toolCallId));
    },
  });

  const write = defineTool({
    name: "write",
    label: "Write",
    description: "完整覆写当前项目中已存在的笔记。path 必须是 ls/find 返回的根级笔记标识；新建文章使用 create_piece。带文本标注的 Inbox 应使用 edit。",
    parameters: Type.Object({
      path: Type.String({ description: "ls/find 返回的当前项目根级笔记标识；目标必须已经存在" }),
      content: Type.String({ description: "Content to write to the file" }),
    }),
    executionMode: "sequential",
    async execute(toolCallId) {
      return mutationResult(await coordinator.commitForTool(toolCallId));
    },
  });

  const createPiece = defineTool({
    name: "create_piece",
    label: "Create piece",
    description: "在当前已由 FloatNote 选定的平面项目中创建一个新 piece。title 是自然标题，不是路径；不要包含项目名或 .md。只创建，不覆写已有笔记。",
    parameters: Type.Object({
      title: Type.String({ description: "新文章的自然标题，不是路径；不要包含项目名或 .md" }),
      content: Type.String({ description: "新文章的完整 Markdown 正文" }),
    }),
    executionMode: "sequential",
    async execute(toolCallId) {
      return mutationResult(await coordinator.commitForTool(toolCallId));
    },
  });

  return [...createReadOnlyWorkspaceTools({ workspace }), edit, write, createPiece];
}

export function createWorkspaceExtension(tools: ToolDefinition[]): InlineExtension {
  return {
    name: "floatnote-workspace",
    factory(pi) {
      for (const tool of tools) pi.registerTool(tool);
    },
  };
}
