import {
  addAnnotationRanges,
  decodeInbox,
  eligibleSelectionRanges,
  encodeInbox,
  findExactText,
  freeColors,
  isValidTagName,
  mapAnnotations,
  mapQuoteSources,
  removeAnnotationRanges,
  type InboxMetadata,
  type TextChange,
} from "@floatnote/note-logic";
import type { EditPreview } from "../protocol.js";
import type { PreparedMutation, WorkspaceClient } from "./types.js";

export interface EditInput {
  path: string;
  edits: Array<{ oldText: string; newText: string }>;
}

export interface WriteInput {
  path: string;
  content: string;
}

export interface TagTextInput {
  exact: string;
  prefix?: string;
  suffix?: string;
  tagId: string;
  action: "add" | "remove";
}

export interface TagCreateInput {
  name: string;
  color: string;
}

export interface TagUpdateInput {
  tagId: string;
  name?: string;
  color?: string;
}

export interface TagDeleteInput {
  tagId: string;
}

export type TagMutationInput = TagTextInput | TagCreateInput | TagUpdateInput | TagDeleteInput;
export type TagMutationTool = "tag_text" | "tag_create" | "tag_update" | "tag_delete";

let annotationSequence = 0;

function annotationId(): string {
  annotationSequence += 1;
  return `ann-ai-${Date.now().toString(36)}-${annotationSequence.toString(36)}`;
}

function slug(name: string, existing: string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "tag";
  if (!existing.includes(base)) return base;
  let suffix = 2;
  while (existing.includes(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function unifiedDiff(before: string, after: string): string {
  const left = before.split("\n");
  const right = after.split("\n");
  const lines: string[] = [];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === right[index]) {
      if (left[index] !== undefined) lines.push(`  ${left[index]}`);
    } else {
      if (left[index] !== undefined) lines.push(`- ${left[index]}`);
      if (right[index] !== undefined) lines.push(`+ ${right[index]}`);
    }
  }
  return lines.join("\n");
}

function rejectDamagedMetadata(warnings: ReturnType<typeof decodeInbox>["warnings"]): void {
  if (warnings.length > 0) {
    throw new Error(`Inbox metadata 已损坏，拒绝写入：${warnings.map((warning) => warning.code).join(", ")}`);
  }
}

function locateChanges(markdown: string, edits: EditInput["edits"]): TextChange[] {
  if (edits.length === 0) throw new Error("edits 至少需要一项替换");
  const changes = edits.map((edit) => {
    if (!edit.oldText) throw new Error("oldText 不能为空");
    const from = markdown.indexOf(edit.oldText);
    if (from < 0) throw new Error("未找到要替换的文本");
    if (markdown.indexOf(edit.oldText, from + 1) >= 0) {
      throw new Error("要替换的文本不唯一，请补充更多上下文");
    }
    return { from, to: from + edit.oldText.length, insert: edit.newText };
  }).sort((left, right) => left.from - right.from || left.to - right.to);
  for (let index = 1; index < changes.length; index += 1) {
    if (changes[index].from < changes[index - 1].to) {
      throw new Error("多个 edits 不能重叠或嵌套");
    }
  }
  return changes;
}

function applyChanges(markdown: string, changes: readonly TextChange[]): string {
  let output = markdown;
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    const change = changes[index];
    output = output.slice(0, change.from) + change.insert + output.slice(change.to);
  }
  return output;
}

export async function prepareEdit(
  workspace: WorkspaceClient,
  input: EditInput,
): Promise<PreparedMutation> {
  const oldContent = await workspace.readRawProject(input.path);
  const decoded = input.path === "_inbox.md" ? decodeInbox(oldContent) : undefined;
  if (decoded) rejectDamagedMetadata(decoded.warnings);
  const oldClean = decoded?.markdown ?? oldContent;
  const changes = locateChanges(oldClean, input.edits);
  const newClean = applyChanges(oldClean, changes);
  let newContent = newClean;
  if (decoded) {
    const metadata: InboxMetadata = {
      ...decoded.metadata,
      annotations: mapAnnotations(decoded.metadata.annotations, changes),
      quoteSources: mapQuoteSources(oldClean, newClean, decoded.metadata.quoteSources, changes),
    };
    newContent = encodeInbox(newClean, metadata);
  }
  return {
    path: input.path,
    operation: "edit",
    oldContent,
    newContent,
    createOnly: false,
    preview: {
      tool: "edit",
      summary: `编辑「${input.path}」`,
      detail: { kind: "diff", hunks: unifiedDiff(oldClean, newClean) },
    },
  };
}

function validateNewPiecePath(notePath: string): void {
  if (notePath === "_inbox.md" || notePath === "_tasks.md" || notePath.startsWith("_")) {
    throw new Error("Agent 不能创建系统文件，只能创建 piece");
  }
  if (
    !notePath.endsWith(".md")
    || notePath.length <= 3
    || notePath.includes("/")
    || notePath.includes("\\")
    || notePath.includes("\0")
    || notePath === "."
    || notePath === ".."
    || /^[A-Za-z]:/.test(notePath)
  ) {
    throw new Error("新 piece 必须是当前项目根目录中的小写 .md 文件名");
  }
}

export async function prepareWrite(
  workspace: WorkspaceClient,
  input: WriteInput,
): Promise<PreparedMutation> {
  const entries = await workspace.listEntries();
  const existing = entries.find((entry) => entry.path === input.path);
  if (!existing) {
    validateNewPiecePath(input.path);
    return {
      path: input.path,
      operation: "create",
      oldContent: "",
      newContent: input.content,
      createOnly: true,
      preview: {
        tool: "write",
        summary: `创建文档「${input.path}」`,
        detail: { kind: "note_create", filename: input.path, contentPreview: input.content.slice(0, 240) },
      },
    };
  }

  const oldContent = await workspace.readRawProject(input.path);
  let oldClean = oldContent;
  let newContent = input.content;
  if (input.path === "_inbox.md") {
    const decoded = decodeInbox(oldContent);
    rejectDamagedMetadata(decoded.warnings);
    if (decoded.metadata.annotations.length > 0) {
      throw new Error("Inbox 含有文本标注，请使用 edit 保留标注");
    }
    oldClean = decoded.markdown;
    newContent = encodeInbox(input.content, {
      tags: decoded.metadata.tags,
      annotations: [],
      quoteSources: [],
    });
  }
  return {
    path: input.path,
    operation: "rewrite",
    oldContent,
    newContent,
    createOnly: false,
    preview: {
      tool: "write",
      summary: `覆写「${input.path}」`,
      detail: { kind: "diff", hunks: unifiedDiff(oldClean, input.content) },
    },
  };
}

function inboxPreview(
  metadata: InboxMetadata,
  tagId: string,
  exact: string,
  action: "add" | "remove",
) {
  const tag = metadata.tags.find((item) => item.id === tagId);
  return {
    kind: "tag_assign" as const,
    textExcerpt: exact.slice(0, 80),
    targetText: exact,
    annotationCount: metadata.annotations.filter((annotation) => annotation.tagId === tagId).length,
    action,
    tagName: tag?.name ?? tagId,
    tagColor: tag?.color ?? "#888888",
  };
}

export async function prepareTagMutation(
  workspace: WorkspaceClient,
  toolName: TagMutationTool,
  input: TagMutationInput,
): Promise<PreparedMutation> {
  const path = "_inbox.md";
  const oldContent = await workspace.readRawProject(path);
  const decoded = decodeInbox(oldContent);
  rejectDamagedMetadata(decoded.warnings);
  let metadata: InboxMetadata;
  let preview: EditPreview;

  switch (toolName) {
    case "tag_text": {
      const params = input as TagTextInput;
      if (!params.exact) throw new Error("目标文本不能为空");
      if (!decoded.metadata.tags.some((tag) => tag.id === params.tagId)) {
        throw new Error(`未知标签：${params.tagId}`);
      }
      const match = findExactText(decoded.markdown, params);
      if (!match.ok) throw new Error(`定位文本失败：${match.error}`);
      const ranges = eligibleSelectionRanges(decoded.markdown, match);
      if (ranges.length === 0) throw new Error("目标文本不在可标注的 Markdown 正文中");
      const annotations = params.action === "add"
        ? addAnnotationRanges(decoded.metadata.annotations, params.tagId, ranges, annotationId)
        : removeAnnotationRanges(decoded.metadata.annotations, params.tagId, ranges, annotationId);
      metadata = { ...decoded.metadata, annotations };
      preview = {
        tool: toolName,
        summary: `${params.action === "add" ? "添加" : "移除"}文本标签`,
        detail: inboxPreview(metadata, params.tagId, params.exact, params.action),
      };
      break;
    }
    case "tag_create": {
      const params = input as TagCreateInput;
      if (!isValidTagName(params.name)) {
        throw new Error("标签名不能为空、不能换行，且不能超过 80 个字符");
      }
      const free = freeColors(new Set(decoded.metadata.tags.map((tag) => tag.color.toLowerCase())));
      if (!free.some((color) => color.toLowerCase() === params.color.toLowerCase())) {
        throw new Error(`颜色 ${params.color} 不可用；可用：${JSON.stringify(free)}`);
      }
      const tag = {
        id: slug(params.name, decoded.metadata.tags.map((item) => item.id)),
        name: params.name,
        color: params.color,
      };
      metadata = { ...decoded.metadata, tags: [...decoded.metadata.tags, tag] };
      preview = {
        tool: toolName,
        summary: `新建标签「${params.name}」`,
        detail: { kind: "tag_create", tagName: params.name, tagColor: params.color },
      };
      break;
    }
    case "tag_update": {
      const params = input as TagUpdateInput;
      if (params.name === undefined && params.color === undefined) {
        throw new Error("tag_update 至少需要 name 或 color");
      }
      if (params.name !== undefined && !isValidTagName(params.name)) {
        throw new Error("标签名不能为空、不能换行，且不能超过 80 个字符");
      }
      const oldTag = decoded.metadata.tags.find((tag) => tag.id === params.tagId);
      if (!oldTag) throw new Error(`未知标签：${params.tagId}`);
      if (params.color) {
        const free = freeColors(new Set(decoded.metadata.tags
          .filter((tag) => tag.id !== params.tagId)
          .map((tag) => tag.color.toLowerCase())));
        if (!free.some((color) => color.toLowerCase() === params.color?.toLowerCase())) {
          throw new Error(`颜色 ${params.color} 不可用`);
        }
      }
      const updated = {
        ...oldTag,
        ...(params.name !== undefined ? { name: params.name } : {}),
        ...(params.color !== undefined ? { color: params.color } : {}),
      };
      metadata = {
        ...decoded.metadata,
        tags: decoded.metadata.tags.map((tag) => tag.id === params.tagId ? updated : tag),
      };
      preview = {
        tool: toolName,
        summary: `修改标签「${oldTag.name}」`,
        detail: {
          kind: "tag_update",
          tagId: oldTag.id,
          oldName: oldTag.name,
          oldColor: oldTag.color,
          newName: updated.name,
          newColor: updated.color,
        },
      };
      break;
    }
    case "tag_delete": {
      const params = input as TagDeleteInput;
      const tag = decoded.metadata.tags.find((item) => item.id === params.tagId);
      const annotationCount = decoded.metadata.annotations
        .filter((annotation) => annotation.tagId === params.tagId).length;
      metadata = {
        ...decoded.metadata,
        tags: decoded.metadata.tags.filter((item) => item.id !== params.tagId),
        annotations: decoded.metadata.annotations.filter(
          (annotation) => annotation.tagId !== params.tagId,
        ),
      };
      preview = {
        tool: toolName,
        summary: `删除标签「${tag?.name ?? params.tagId}」`,
        detail: { kind: "tag_delete", tagName: tag?.name ?? params.tagId, annotationCount },
      };
      break;
    }
    default: {
      const exhaustive: never = toolName;
      throw new Error(`不支持的标签工具：${exhaustive}`);
    }
  }

  return {
    path,
    operation: "tag",
    oldContent,
    newContent: encodeInbox(decoded.markdown, metadata),
    createOnly: false,
    preview,
  };
}
