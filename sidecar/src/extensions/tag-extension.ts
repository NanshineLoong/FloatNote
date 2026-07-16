import { decodeInbox, freeColors } from "@floatnote/note-logic";
import {
  defineTool,
  type InlineExtension,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { MutationCoordinator } from "../workspace/mutation-coordinator.js";
import type { WorkspaceClient } from "../workspace/types.js";

function mutationResult(result: { ok: boolean; version?: number }) {
  const text = result.version ? `已更新，版本 v${result.version}` : "已更新";
  return { content: [{ type: "text" as const, text }], details: {} };
}

export function createTagTools(
  workspace: WorkspaceClient,
  coordinator: MutationCoordinator,
): ToolDefinition[] {
  const listTags = defineTool({
    name: "list_tags",
    label: "List tags",
    description: "列出采集区标签与可用颜色。",
    parameters: Type.Object({}),
    async execute() {
      const decoded = decodeInbox(await workspace.readRawProject("_inbox.md"));
      const free = freeColors(new Set(decoded.metadata.tags.map((tag) => tag.color.toLowerCase())));
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ tags: decoded.metadata.tags, freeColors: free }),
        }],
        details: {},
      };
    },
  });

  const tagText = defineTool({
    name: "tag_text",
    label: "Tag text",
    description: "按 exact 与可选 prefix/suffix 唯一定位 Inbox 文本，并添加或移除标签。",
    parameters: Type.Object({
      exact: Type.String({ minLength: 1 }),
      prefix: Type.Optional(Type.String()),
      suffix: Type.Optional(Type.String()),
      tagId: Type.String(),
      action: Type.Union([Type.Literal("add"), Type.Literal("remove")]),
    }),
    executionMode: "sequential",
    async execute(toolCallId) {
      return mutationResult(await coordinator.commitForTool(toolCallId));
    },
  });

  const tagCreate = defineTool({
    name: "tag_create",
    label: "Create tag",
    description: "新建 Inbox 标签。",
    parameters: Type.Object({ name: Type.String(), color: Type.String() }),
    executionMode: "sequential",
    async execute(toolCallId) {
      return mutationResult(await coordinator.commitForTool(toolCallId));
    },
  });

  const tagUpdate = defineTool({
    name: "tag_update",
    label: "Update tag",
    description: "修改 Inbox 标签。",
    parameters: Type.Object({
      tagId: Type.String(),
      name: Type.Optional(Type.String()),
      color: Type.Optional(Type.String()),
    }),
    executionMode: "sequential",
    async execute(toolCallId) {
      return mutationResult(await coordinator.commitForTool(toolCallId));
    },
  });

  const tagDelete = defineTool({
    name: "tag_delete",
    label: "Delete tag",
    description: "删除 Inbox 标签及其全部文本标注。",
    parameters: Type.Object({ tagId: Type.String() }),
    executionMode: "sequential",
    async execute(toolCallId) {
      return mutationResult(await coordinator.commitForTool(toolCallId));
    },
  });

  return [listTags, tagText, tagCreate, tagUpdate, tagDelete];
}

export function createTagExtension(tools: ToolDefinition[]): InlineExtension {
  return {
    name: "floatnote-tags",
    factory(pi) {
      for (const tool of tools) pi.registerTool(tool);
    },
  };
}
