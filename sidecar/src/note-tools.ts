import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  setBlockTagChange, addTagDefChange,
  deleteTagChanges, parseDefs, stripTagMarker, countMarkers,
  applyChange, applyChanges,
  freeColors,
} from "@floatnote/note-logic";
import { replaceOnce, findBlockByAnchor } from "./matching.js";
import type { NoteTarget, EditPreview } from "./protocol.js";

export interface WriteResult { ok: boolean; version?: number; denied?: boolean; error?: string; }

export interface NoteToolDeps {
  getNoteText: (target?: NoteTarget) => Promise<string>;
  requestWrite: (args: { target?: NoteTarget; toolName: string; oldContent: string; newContent: string; preview: EditPreview }) => Promise<WriteResult>;
  /** Return a loaded skill's full SKILL.md text by name, or null if unknown. */
  readSkillBody: (name: string) => string | null;
}

export function createNoteTools(deps: NoteToolDeps): ToolDefinition[] {
  // All tag tools are scoped to the inbox. Resolve/validate the target once
  // so each tool repeats neither the kind guard nor the name-carry spread.
  // Returns the normalized inbox target, or an error tool result to short-circuit.
  function inboxTarget(
    toolName: string,
    target?: NoteTarget,
  ):
    | { ok: true; target: NoteTarget }
    | { ok: false; result: ReturnType<typeof errorResult> } {
    if (target?.kind && target.kind !== "inbox") {
      return { ok: false, result: errorResult(`${toolName} 仅支持 inbox 目标，收到 kind="${target.kind}"`) };
    }
    return { ok: true, target: { kind: "inbox", ...(target?.name ? { name: target.name } : {}) } };
  }
  const readNote = defineTool({
    name: "read_note",
    label: "Read note",
    description: "读取目标笔记的全文。target 缺省=当前活动笔记。",
    parameters: Type.Object({ target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })) }),
    promptSnippet: "read_note — 读笔记全文",
    async execute(_id, params: { target?: NoteTarget }) {
      const content = await deps.getNoteText(params.target);
      return { content: [{ type: "text", text: content }], details: {} };
    },
  });

  const listTags = defineTool({
    name: "list_tags",
    label: "List tags",
    description: "列出采集区（_inbox）已定义的标签与可用颜色。仅在 target=inbox 时有意义。",
    parameters: Type.Object({ target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })) }),
    promptSnippet: "list_tags — 列标签与可用颜色",
    async execute(_id, params: { target?: NoteTarget }) {
      const doc = await deps.getNoteText({ kind: "inbox", ...(params.target?.name ? { name: params.target.name } : {}) });
      const map = parseDefs(doc);
      const used = new Set([...map.values()].map((d) => d.color.toLowerCase()));
      const tags = [...map.values()].map((d) => ({ id: d.id, name: d.name, color: d.color }));
      const free = freeColors(used);
      return { content: [{ type: "text", text: JSON.stringify({ tags, freeColors: free }) }], details: {} };
    },
  });

  const editNote = defineTool({
    name: "edit_note",
    label: "Edit note",
    description: "精确替换目标笔记中唯一出现的 old_string 为 new_string。用于改块/插块/删块/改任务。old_string 必须唯一，否则报错。",
    parameters: Type.Object({
      old_string: Type.String({ description: "要替换的原文，必须在全文中唯一" }),
      new_string: Type.String({ description: "替换后的新文本" }),
      target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })),
    }),
    promptSnippet: "edit_note — 唯一 str_replace",
    async execute(_id, params: { old_string: string; new_string: string; target?: NoteTarget }) {
      const old = await deps.getNoteText(params.target);
      const r = replaceOnce(old, params.old_string, params.new_string);
      if (!r.ok) return { content: [{ type: "text", text: `替换失败：${r.error}` }], details: {} };
      const preview: EditPreview = { tool: "edit_note", summary: "编辑文本", detail: { kind: "diff", hunks: unifiedDiff(old, r.newContent) } };
      const res = await deps.requestWrite({ target: params.target, toolName: "edit_note", oldContent: old, newContent: r.newContent, preview });
      return writeResultText(res);
    },
  });

  const writeNote = defineTool({
    name: "write_note",
    label: "Write note",
    description: "整篇覆写目标笔记。仅在大重构/跨多块改写时用。每次写入前用户可选择保存旧版本快照。",
    parameters: Type.Object({
      content: Type.String({ description: "新全文" }),
      target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })),
    }),
    promptSnippet: "write_note — 整篇覆写",
    async execute(_id, params: { content: string; target?: NoteTarget }) {
      const old = await deps.getNoteText(params.target);
      const preview: EditPreview = { tool: "write_note", summary: "整篇覆写", detail: { kind: "diff", hunks: unifiedDiff(old, params.content) } };
      const res = await deps.requestWrite({ target: params.target, toolName: "write_note", oldContent: old, newContent: params.content, preview });
      return writeResultText(res);
    },
  });

  const setTag = defineTool({
    name: "set_tag",
    label: "Set tag",
    description: "给采集区某块打/清标签。anchor=块首行前缀（唯一）。tagId=null 清除。target 必须 inbox。",
    parameters: Type.Object({
      anchor: Type.String({ description: "块首行前缀，须唯一匹配一个块" }),
      tagId: Type.Optional(Type.String({ description: "标签 id；省略或空串=清除该块标签" })),
      target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })),
    }),
    promptSnippet: "set_tag — 给块打标签",
    async execute(_id, params: { anchor: string; tagId?: string; target?: NoteTarget }) {
      const t = inboxTarget("set_tag", params.target);
      if (!t.ok) return t.result;
      const { target } = t;
      const old = await deps.getNoteText(target);
      const r = findBlockByAnchor(old, params.anchor);
      if (!r.ok) return errorResult(`定位块失败：${r.error}`);
      const change = setBlockTagChange(old, r.range, params.tagId || null);
      const newContent = change ? applyChange(old, change) : old;
      const def = params.tagId ? parseDefs(old).get(params.tagId) : undefined;
      const tagName = params.tagId ? (def?.name ?? params.tagId) : "(清除)";
      const tagColor = params.tagId ? (def?.color ?? "#888") : "#888";
      const blockText = stripTagMarker(old.slice(r.range.from, r.range.to));
      const blockPreview = blockText.split("\n")[0].slice(0, 20);
      const preview: EditPreview = { tool: "set_tag", summary: `给块「${blockPreview}」${params.tagId ? "打上" : "清除"}标签`, detail: { kind: "tag_assign", blockPreview, tagName, tagColor } };
      const res = await deps.requestWrite({ target, toolName: "set_tag", oldContent: old, newContent, preview });
      return writeResultText(res);
    },
  });

  const tagCreate = defineTool({
    name: "tag_create",
    label: "Create tag",
    description: "在采集区新建标签定义。color 必须从 list_tags 返回的 freeColors 中选一个。target 必须 inbox。",
    parameters: Type.Object({
      name: Type.String({ description: "标签名" }),
      color: Type.String({ description: "颜色 hex，须为可用色" }),
      target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })),
    }),
    promptSnippet: "tag_create — 新建标签",
    async execute(_id, params: { name: string; color: string; target?: NoteTarget }) {
      const t = inboxTarget("tag_create", params.target);
      if (!t.ok) return t.result;
      const { target } = t;
      const old = await deps.getNoteText(target);
      const free = freeColors(new Set([...parseDefs(old).values()].map((d) => d.color.toLowerCase())));
      // addTagDefChange only rejects colors already in use, not off-palette
      // colors — guard palette membership here so non-palette values like
      // "#000000" are rejected with a helpful "available colors" list.
      if (!free.map((c) => c.toLowerCase()).includes(params.color.toLowerCase())) {
        return errorResult(`颜色 ${params.color} 不可用；可用：${JSON.stringify(free)}`);
      }
      const r = addTagDefChange(old, params.name, params.color);
      if (!r.id) return errorResult(`建标签失败：颜色 ${params.color} 已被占用；可用：${JSON.stringify(free)}`);
      const newContent = r.change ? applyChange(old, r.change) : old;
      const preview: EditPreview = { tool: "tag_create", summary: `新建标签「${params.name}」`, detail: { kind: "tag_create", tagName: params.name, tagColor: params.color } };
      const res = await deps.requestWrite({ target, toolName: "tag_create", oldContent: old, newContent, preview });
      return writeResultText(res);
    },
  });

  const tagDelete = defineTool({
    name: "tag_delete",
    label: "Delete tag",
    description: "删除采集区某标签定义及其所有块标记。target 必须 inbox。",
    parameters: Type.Object({
      tagId: Type.String({ description: "要删除的标签 id" }),
      target: Type.Optional(Type.Object({ kind: Type.String(), name: Type.Optional(Type.String()) })),
    }),
    promptSnippet: "tag_delete — 删标签",
    async execute(_id, params: { tagId: string; target?: NoteTarget }) {
      const t = inboxTarget("tag_delete", params.target);
      if (!t.ok) return t.result;
      const { target } = t;
      const old = await deps.getNoteText(target);
      const changes = deleteTagChanges(old, params.tagId);
      const newContent = applyChanges(old, changes);
      const def = parseDefs(old).get(params.tagId);
      const markerCount = countMarkers(old, params.tagId);
      const preview: EditPreview = { tool: "tag_delete", summary: `删除标签「${def?.name ?? params.tagId}」`, detail: { kind: "tag_delete", tagName: def?.name ?? params.tagId, markerCount } };
      const res = await deps.requestWrite({ target, toolName: "tag_delete", oldContent: old, newContent, preview });
      return writeResultText(res);
    },
  });

  const readSkill = defineTool({
    name: "read_skill",
    label: "Read skill",
    description:
      "按 name 加载某条 skill 的完整 SKILL.md 全文。这是加载 skill 指南的唯一途径（系统提示里的 available_skills 只是描述）。仅接受已加载 skill 的 name，不接受路径。",
    parameters: Type.Object({ name: Type.String({ description: "要加载的 skill 名称（见 available_skills）" }) }),
    promptSnippet: "read_skill — 读 skill 全文",
    async execute(_id, params: { name: string }) {
      const body = deps.readSkillBody(params.name);
      if (body == null) {
        throw new Error(`未知 skill: ${params.name}`);
      }
      return { content: [{ type: "text", text: body }], details: {} };
    },
  });

  return [readNote, listTags, editNote, writeNote, setTag, tagCreate, tagDelete, readSkill];
}

function writeResultText(res: WriteResult) {
  const text = res.denied
    ? "用户拒绝了此操作"
    : res.ok
      ? (res.version ? `已更新，版本 v${res.version}` : "已更新")
      : `写入失败：${res.error ?? "未知错误"}`;
  return {
    content: [{ type: "text" as const, text }],
    details: {},
  };
}

/** Build a text-only tool result for an error message (no write performed). */
function errorResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
  };
}

function unifiedDiff(a: string, b: string): string {
  // 轻量 diff：按行比对，足够气泡展示。首版用简单逐行 unified 形式。
  const la = a.split("\n"), lb = b.split("\n");
  const lines: string[] = [];
  const n = Math.max(la.length, lb.length);
  for (let i = 0; i < n; i++) {
    if (la[i] !== lb[i]) {
      if (la[i] !== undefined) lines.push(`- ${la[i]}`);
      if (lb[i] !== undefined) lines.push(`+ ${lb[i]}`);
    } else if (la[i] !== undefined) {
      lines.push(`  ${la[i]}`);
    }
  }
  return lines.join("\n");
}
