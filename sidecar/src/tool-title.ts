const MAX_TARGET = 48;
const MAX_ERROR = 120;

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
  return value;
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

function markdownName(value: unknown): string {
  const name = shortLine(value) ?? "文档";
  return name.toLowerCase().endsWith(".md") ? name : `${name}.md`;
}

export function formatToolTitle(name: string, args: unknown): string {
  const value = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const target = noteTarget(value);
  switch (name) {
    case "read_note": return target ? `读取 ${target}` : "读取当前文档";
    case "list_notes": return "列出项目文档";
    case "create_note": return `创建 ${markdownName(value.title ?? value.name)}`;
    case "edit_note":
    case "write_note": return target ? `编辑 ${target}` : "编辑当前文档";
    case "list_tags": return "列出标签";
    case "tag_text": {
      const exact = shortLine(value.exact, 32);
      return exact ? `给“${exact}”设置标签` : "设置文本标签";
    }
    case "tag_create": return `新建标签 ${shortLine(value.tagName ?? value.name) ?? ""}`.trim();
    case "tag_update": return `修改标签 ${shortLine(value.tagName ?? value.name ?? value.newName) ?? ""}`.trim();
    case "tag_delete": return `删除标签 ${shortLine(value.tagName ?? value.name) ?? ""}`.trim();
    case "read_skill": return `读取技能 ${shortLine(value.name) ?? ""}`.trim();
    case "web_search": return `搜索网页 ${shortLine(value.query) ?? ""}`.trim();
    case "web_fetch": return `读取网页 ${domainOf(value.url) ?? ""}`.trim();
    default: return name;
  }
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
