const MAX_TARGET = 48;
const MAX_ERROR = 120;

export type ToolCategory =
  | "skill"
  | "document_read"
  | "document_list"
  | "document_find"
  | "document_search"
  | "web_search"
  | "web_fetch"
  | "document_write"
  | "document_create"
  | "tag"
  | "other";

export interface ToolPresentation {
  category: ToolCategory;
  label: string;
}

function shortLine(value: unknown, max = MAX_TARGET): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  if (!line) return undefined;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function noteTarget(args: Record<string, unknown>): string | undefined {
  const raw = args.target ?? args.file_path ?? args.path;
  if (raw && typeof raw === "object") {
    const target = raw as Record<string, unknown>;
    if (target.kind === "tasks") return "行动清单";
    if (target.kind === "inbox") return "采集区";
    return shortLine(target.name);
  }
  const value = shortLine(raw);
  if (value === "_tasks.md") return "行动清单";
  if (value === "_inbox.md") return "采集区";
  if (!value) return undefined;
  const segments = value.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? value;
}

function skillNameOf(args: Record<string, unknown>): string | undefined {
  const raw = shortLine(args.path ?? args.file_path ?? args.target, 300);
  if (!raw) return undefined;
  const segments = raw.split(/[\\/]/).filter(Boolean);
  if (segments.at(-1) !== "SKILL.md") return undefined;
  const name = segments.at(-2);
  return name && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(name) ? name : undefined;
}

function domainOf(value: unknown): string | undefined {
  const raw = shortLine(value, 300);
  if (!raw) return undefined;
  try {
    return new URL(raw).hostname || undefined;
  } catch {
    return undefined;
  }
}

export function formatToolPresentation(name: string, args: unknown): ToolPresentation {
  const value = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const target = noteTarget(value);
  switch (name) {
    case "ls": return { category: "document_list", label: "列出项目文档" };
    case "read": {
      const skillName = skillNameOf(value);
      return skillName
        ? { category: "skill", label: `读取技能 ${skillName}` }
        : { category: "document_read", label: target ? `读取 ${target}` : "读取文档" };
    }
    case "find": return { category: "document_find", label: `查找文档 ${shortLine(value.pattern) ?? ""}`.trim() };
    case "grep": return { category: "document_search", label: `搜索文档 ${shortLine(value.pattern) ?? ""}`.trim() };
    case "edit": return { category: "document_write", label: target ? `编辑 ${target}` : "编辑文档" };
    case "write": return { category: "document_write", label: target ? `写入 ${target}` : "写入文档" };
    case "create_piece": return { category: "document_create", label: `创建 ${shortLine(value.title) ?? "新文章"}` };
    case "list_tags": return { category: "tag", label: "列出标签" };
    case "tag_text": {
      const exact = shortLine(value.exact, 32);
      return { category: "tag", label: exact ? `给“${exact}”设置标签` : "设置文本标签" };
    }
    case "tag_create": return { category: "tag", label: `新建标签 ${shortLine(value.tagName ?? value.name) ?? ""}`.trim() };
    case "tag_update": return { category: "tag", label: `修改标签 ${shortLine(value.tagName ?? value.name ?? value.newName) ?? ""}`.trim() };
    case "tag_delete": return { category: "tag", label: `删除标签 ${shortLine(value.tagName ?? value.name) ?? ""}`.trim() };
    case "web_search": return { category: "web_search", label: `搜索网页 ${shortLine(value.query) ?? ""}`.trim() };
    case "web_fetch": return { category: "web_fetch", label: `获取网页 ${domainOf(value.url) ?? ""}`.trim() };
    default: return { category: "other", label: name };
  }
}

export function formatToolTitle(name: string, args: unknown): string {
  return formatToolPresentation(name, args).label;
}

export function sanitizeToolError(value: unknown): string | undefined {
  let raw: unknown = value;
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    raw = record.error ?? record.message ?? record.content;
  }
  if (Array.isArray(raw)) {
    raw = raw.find((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string");
    raw = raw && typeof raw === "object" ? (raw as Record<string, unknown>).text : raw;
  }
  const firstLine = typeof raw === "string" ? raw.split(/[\r\n]/, 1)[0] : undefined;
  return shortLine(firstLine, MAX_ERROR);
}
