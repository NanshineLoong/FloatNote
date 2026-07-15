import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  addAnnotationRanges,
  decodeInbox,
  eligibleSelectionRanges,
  encodeInbox,
  findExactText,
  freeColors,
  mapAnnotations,
  mapQuoteSources,
  removeAnnotationRanges,
  isValidTagName,
  type InboxMetadata,
} from "@floatnote/note-logic";
import { replaceOnce } from "./matching.js";
import type { NoteTarget, EditPreview } from "./protocol.js";

export interface WriteResult { ok: boolean; version?: number; denied?: boolean; error?: string }
export interface NoteListEntry { kind: "inbox" | "tasks" | "piece"; name: string }
export interface CreateNoteResult { ok: boolean; denied?: boolean; name?: string; error?: string }

export interface NoteToolDeps {
  getNoteText: (target?: NoteTarget) => Promise<string>;
  listNotes: () => Promise<NoteListEntry[]>;
  requestCreateNote: (args: { toolCallId: string; title: string; content: string; preview: EditPreview }) => Promise<CreateNoteResult>;
  requestWrite: (args: { toolCallId: string; target?: NoteTarget; toolName: string; oldContent: string; newContent: string; preview: EditPreview }) => Promise<WriteResult>;
  readSkillBody: (name: string) => string | null;
}

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

function isEncodedInbox(content: string): boolean {
  return /<!-- floatnote:(?:tags:v2|ann:v2|bid=)/.test(content) || /^<!-- floatnote-tags:/.test(content);
}

function shouldDecodeInbox(target: NoteTarget | undefined, content: string): boolean {
  return target?.kind === "inbox" || (target === undefined && isEncodedInbox(content));
}

function tagTarget(toolName: string, target?: NoteTarget) {
  if (target?.kind && target.kind !== "inbox") {
    return { ok: false as const, result: errorResult(`${toolName} 仅支持 inbox 目标，收到 kind="${target.kind}"`) };
  }
  return { ok: true as const, target: { kind: "inbox" as const, ...(target?.name ? { name: target.name } : {}) } };
}

function inboxPreview(metadata: InboxMetadata, tagId: string, exact: string, action: "add" | "remove") {
  const tag = metadata.tags.find((item) => item.id === tagId);
  return {
    kind: "tag_assign" as const,
    textExcerpt: exact.slice(0, 80),
    annotationCount: metadata.annotations.filter((annotation) => annotation.tagId === tagId).length,
    action,
    tagName: tag?.name ?? tagId,
    tagColor: tag?.color ?? "#888888",
  };
}

export function createNoteTools(deps: NoteToolDeps): ToolDefinition[] {
  const readNote = defineTool({
    name: "read_note",
    label: "Read note",
    description: "读取目标笔记的全文。Inbox 返回不含内部 metadata 的干净 Markdown。",
    parameters: Type.Object({ target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })) }),
    promptSnippet: "read_note — 读笔记全文",
    async execute(_id, params: { target?: NoteTarget }) {
      const raw = await deps.getNoteText(params.target);
      const content = shouldDecodeInbox(params.target, raw) ? decodeInbox(raw).markdown : raw;
      return { content: [{ type: "text" as const, text: content }], details: {} };
    },
  });

  const listNotes = defineTool({
    name: "list_notes",
    label: "List notes",
    description: "列出当前项目空间的 inbox、tasks 与全部 piece。",
    parameters: Type.Object({}),
    promptSnippet: "list_notes — 列当前项目笔记",
    async execute() {
      return { content: [{ type: "text" as const, text: JSON.stringify(await deps.listNotes()) }], details: {} };
    },
  });

  const createNote = defineTool({
    name: "create_note",
    label: "Create note",
    description: "经用户确认后在当前项目空间新建一个 piece。",
    parameters: Type.Object({ title: Type.String(), content: Type.Optional(Type.String()) }),
    promptSnippet: "create_note — 新建 piece",
    async execute(toolCallId, params: { title: string; content?: string }) {
      const filename = `${params.title.trim().replace(/\.md$/i, "")}.md`;
      const content = params.content ?? "";
      const preview: EditPreview = { tool: "create_note", summary: `创建文档「${filename}」`, detail: { kind: "note_create", filename, contentPreview: content.slice(0, 240) } };
      const result = await deps.requestCreateNote({ toolCallId, title: params.title, content, preview });
      const text = result.denied ? "用户拒绝了此操作" : result.ok ? `已创建 ${result.name ?? filename}` : `创建失败：${result.error ?? "未知错误"}`;
      return { content: [{ type: "text" as const, text }], details: {} };
    },
  });

  const listTags = defineTool({
    name: "list_tags",
    label: "List tags",
    description: "列出采集区标签与可用颜色。",
    parameters: Type.Object({ target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })) }),
    promptSnippet: "list_tags — 列标签与可用颜色",
    async execute(_id, params: { target?: NoteTarget }) {
      const raw = await deps.getNoteText({ kind: "inbox", ...(params.target?.name ? { name: params.target.name } : {}) });
      const metadata = decodeInbox(raw).metadata;
      const free = freeColors(new Set(metadata.tags.map((tag) => tag.color.toLowerCase())));
      return { content: [{ type: "text" as const, text: JSON.stringify({ tags: metadata.tags, freeColors: free }) }], details: {} };
    },
  });

  const editNote = defineTool({
    name: "edit_note",
    label: "Edit note",
    description: "精确替换唯一文本。Inbox 会保留并映射文本标注。",
    parameters: Type.Object({ old_string: Type.String(), new_string: Type.String(), target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })) }),
    promptSnippet: "edit_note — 唯一 str_replace",
    async execute(toolCallId, params: { old_string: string; new_string: string; target?: NoteTarget }) {
      const raw = await deps.getNoteText(params.target);
      const inbox = shouldDecodeInbox(params.target, raw);
      const decoded = inbox ? decodeInbox(raw) : null;
      const oldClean = decoded?.markdown ?? raw;
      const match = findExactText(oldClean, { exact: params.old_string });
      if (!match.ok) return errorResult(`替换失败：${match.error === "ambiguous" ? "要替换的文本不唯一，请补充更多上下文" : "未找到要替换的文本"}`);
      const replacement = replaceOnce(oldClean, params.old_string, params.new_string);
      if (!replacement.ok) return errorResult(`替换失败：${replacement.error}`);
      let newContent = replacement.newContent;
      if (decoded) {
        const change = { from: match.from, to: match.to, insert: params.new_string };
        const metadata: InboxMetadata = {
          ...decoded.metadata,
          annotations: mapAnnotations(decoded.metadata.annotations, [change]),
          quoteSources: mapQuoteSources(oldClean, replacement.newContent, decoded.metadata.quoteSources, [change]),
        };
        newContent = encodeInbox(newContent, metadata);
      }
      const preview: EditPreview = { tool: "edit_note", summary: "编辑文本", detail: { kind: "diff", hunks: unifiedDiff(oldClean, replacement.newContent) } };
      return writeResultText(await deps.requestWrite({ toolCallId, target: params.target, toolName: "edit_note", oldContent: raw, newContent, preview }));
    },
  });

  const writeNote = defineTool({
    name: "write_note",
    label: "Write note",
    description: "整篇覆写目标笔记。带文本标注的 Inbox 必须改用 edit_note。",
    parameters: Type.Object({ content: Type.String(), target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })) }),
    promptSnippet: "write_note — 整篇覆写",
    async execute(toolCallId, params: { content: string; target?: NoteTarget }) {
      const raw = await deps.getNoteText(params.target);
      const inbox = shouldDecodeInbox(params.target, raw);
      const decoded = inbox ? decodeInbox(raw) : null;
      if (decoded && decoded.metadata.annotations.length > 0) {
        return errorResult("Inbox 含有文本标注，不能整篇覆写；请使用 edit_note 保留标注");
      }
      const newContent = decoded
        ? encodeInbox(params.content, { tags: decoded.metadata.tags, annotations: [], quoteSources: [] })
        : params.content;
      const preview: EditPreview = { tool: "write_note", summary: "整篇覆写", detail: { kind: "diff", hunks: unifiedDiff(decoded?.markdown ?? raw, params.content) } };
      return writeResultText(await deps.requestWrite({ toolCallId, target: params.target, toolName: "write_note", oldContent: raw, newContent, preview }));
    },
  });

  const tagText = defineTool({
    name: "tag_text",
    label: "Tag text",
    description: "按 exact 与可选 prefix/suffix 唯一定位 Inbox 文本，并添加或移除标签。",
    parameters: Type.Object({
      exact: Type.String(),
      prefix: Type.Optional(Type.String()),
      suffix: Type.Optional(Type.String()),
      tagId: Type.String(),
      action: Type.Union([Type.Literal("add"), Type.Literal("remove")]),
      target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })),
    }),
    promptSnippet: "tag_text — 给精确文本添加/移除标签",
    async execute(toolCallId, params: { exact: string; prefix?: string; suffix?: string; tagId: string; action: "add" | "remove"; target?: NoteTarget }) {
      const guarded = tagTarget("tag_text", params.target);
      if (!guarded.ok) return guarded.result;
      const raw = await deps.getNoteText(guarded.target);
      const decoded = decodeInbox(raw);
      if (!decoded.metadata.tags.some((tag) => tag.id === params.tagId)) return errorResult(`未知标签：${params.tagId}`);
      const match = findExactText(decoded.markdown, params);
      if (!match.ok) return errorResult(`定位文本失败：${match.error}`);
      const ranges = eligibleSelectionRanges(decoded.markdown, match);
      if (ranges.length === 0) return errorResult("目标文本不在可标注的 Markdown 正文中");
      const annotations = params.action === "add"
        ? addAnnotationRanges(decoded.metadata.annotations, params.tagId, ranges, annotationId)
        : removeAnnotationRanges(decoded.metadata.annotations, params.tagId, ranges, annotationId);
      const metadata = { ...decoded.metadata, annotations };
      const preview: EditPreview = { tool: "tag_text", summary: `${params.action === "add" ? "添加" : "移除"}文本标签`, detail: inboxPreview(metadata, params.tagId, params.exact, params.action) };
      return writeResultText(await deps.requestWrite({ toolCallId, target: guarded.target, toolName: "tag_text", oldContent: raw, newContent: encodeInbox(decoded.markdown, metadata), preview }));
    },
  });

  const tagCreate = defineTool({
    name: "tag_create", label: "Create tag", description: "新建 Inbox 标签。",
    parameters: Type.Object({ name: Type.String(), color: Type.String(), target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })) }),
    promptSnippet: "tag_create — 新建标签",
    async execute(toolCallId, params: { name: string; color: string; target?: NoteTarget }) {
      const guarded = tagTarget("tag_create", params.target); if (!guarded.ok) return guarded.result;
      if (!isValidTagName(params.name)) return errorResult("标签名不能为空、不能换行，且不能超过 80 个字符");
      const raw = await deps.getNoteText(guarded.target); const decoded = decodeInbox(raw);
      const free = freeColors(new Set(decoded.metadata.tags.map((tag) => tag.color.toLowerCase())));
      if (!free.some((color) => color.toLowerCase() === params.color.toLowerCase())) return errorResult(`颜色 ${params.color} 不可用；可用：${JSON.stringify(free)}`);
      const tag = { id: slug(params.name, decoded.metadata.tags.map((item) => item.id)), name: params.name, color: params.color };
      const metadata = { ...decoded.metadata, tags: [...decoded.metadata.tags, tag] };
      const preview: EditPreview = { tool: "tag_create", summary: `新建标签「${params.name}」`, detail: { kind: "tag_create", tagName: params.name, tagColor: params.color } };
      return writeResultText(await deps.requestWrite({ toolCallId, target: guarded.target, toolName: "tag_create", oldContent: raw, newContent: encodeInbox(decoded.markdown, metadata), preview }));
    },
  });

  const tagUpdate = defineTool({
    name: "tag_update", label: "Update tag", description: "修改 Inbox 标签。",
    parameters: Type.Object({ tagId: Type.String(), name: Type.Optional(Type.String()), color: Type.Optional(Type.String()), target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })) }),
    promptSnippet: "tag_update — 修改标签",
    async execute(toolCallId, params: { tagId: string; name?: string; color?: string; target?: NoteTarget }) {
      const guarded = tagTarget("tag_update", params.target); if (!guarded.ok) return guarded.result;
      if (params.name === undefined && params.color === undefined) return errorResult("tag_update 至少需要 name 或 color");
      if (params.name !== undefined && !isValidTagName(params.name)) return errorResult("标签名不能为空、不能换行，且不能超过 80 个字符");
      const raw = await deps.getNoteText(guarded.target); const decoded = decodeInbox(raw);
      const oldTag = decoded.metadata.tags.find((tag) => tag.id === params.tagId);
      if (!oldTag) return errorResult(`未知标签：${params.tagId}`);
      if (params.color) {
        const free = freeColors(new Set(decoded.metadata.tags.filter((tag) => tag.id !== params.tagId).map((tag) => tag.color.toLowerCase())));
        if (!free.some((color) => color.toLowerCase() === params.color?.toLowerCase())) return errorResult(`颜色 ${params.color} 不可用`);
      }
      const updated = { ...oldTag, ...(params.name !== undefined ? { name: params.name } : {}), ...(params.color !== undefined ? { color: params.color } : {}) };
      const metadata = { ...decoded.metadata, tags: decoded.metadata.tags.map((tag) => tag.id === params.tagId ? updated : tag) };
      const preview: EditPreview = { tool: "tag_update", summary: `修改标签「${oldTag.name}」`, detail: { kind: "tag_update", tagId: oldTag.id, oldName: oldTag.name, oldColor: oldTag.color, newName: updated.name, newColor: updated.color } };
      return writeResultText(await deps.requestWrite({ toolCallId, target: guarded.target, toolName: "tag_update", oldContent: raw, newContent: encodeInbox(decoded.markdown, metadata), preview }));
    },
  });

  const tagDelete = defineTool({
    name: "tag_delete", label: "Delete tag", description: "删除 Inbox 标签及其全部文本标注。",
    parameters: Type.Object({ tagId: Type.String(), target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })) }),
    promptSnippet: "tag_delete — 删标签",
    async execute(toolCallId, params: { tagId: string; target?: NoteTarget }) {
      const guarded = tagTarget("tag_delete", params.target); if (!guarded.ok) return guarded.result;
      const raw = await deps.getNoteText(guarded.target); const decoded = decodeInbox(raw);
      const tag = decoded.metadata.tags.find((item) => item.id === params.tagId);
      const annotationCount = decoded.metadata.annotations.filter((annotation) => annotation.tagId === params.tagId).length;
      const metadata = { ...decoded.metadata, tags: decoded.metadata.tags.filter((item) => item.id !== params.tagId), annotations: decoded.metadata.annotations.filter((annotation) => annotation.tagId !== params.tagId) };
      const preview: EditPreview = { tool: "tag_delete", summary: `删除标签「${tag?.name ?? params.tagId}」`, detail: { kind: "tag_delete", tagName: tag?.name ?? params.tagId, annotationCount } };
      return writeResultText(await deps.requestWrite({ toolCallId, target: guarded.target, toolName: "tag_delete", oldContent: raw, newContent: encodeInbox(decoded.markdown, metadata), preview }));
    },
  });

  const readSkill = defineTool({
    name: "read_skill", label: "Read skill", description: "按 name 加载 Skill。",
    parameters: Type.Object({ name: Type.String() }), promptSnippet: "read_skill — 读 skill 全文",
    async execute(_id, params: { name: string }) {
      const body = deps.readSkillBody(params.name); if (body == null) throw new Error(`未知 skill: ${params.name}`);
      return { content: [{ type: "text" as const, text: body }], details: {} };
    },
  });

  return [readNote, listNotes, listTags, editNote, writeNote, createNote, tagText, tagCreate, tagUpdate, tagDelete, readSkill];
}

function writeResultText(result: WriteResult) {
  const text = result.denied ? "用户拒绝了此操作" : result.ok ? (result.version ? `已更新，版本 v${result.version}` : "已更新") : `写入失败：${result.error ?? "未知错误"}`;
  return { content: [{ type: "text" as const, text }], details: {} };
}

function errorResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

function unifiedDiff(before: string, after: string): string {
  const left = before.split("\n"), right = after.split("\n"), lines: string[] = [];
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] === right[index]) { if (left[index] !== undefined) lines.push(`  ${left[index]}`); }
    else { if (left[index] !== undefined) lines.push(`- ${left[index]}`); if (right[index] !== undefined) lines.push(`+ ${right[index]}`); }
  }
  return lines.join("\n");
}
