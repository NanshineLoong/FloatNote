export type SelectionSource = {
  kind: "web" | "app";
  title: string;
  url: string | null;
};

export interface SelectionMessage {
  question: string;
  selection: string;
  source: { label: string; url: string | null };
}

function safeWebUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1").replace(/[\r\n]+/g, " ").trim();
}

function unescapeLabel(value: string): string {
  return value.replace(/\\([\\\[\]])/g, "$1");
}

export function buildSelectionMessage(args: {
  question: string;
  selection: string;
  source: SelectionSource | null;
}): string {
  const question = args.question.trim();
  const selection = args.selection.trim();
  const label = escapeLabel(args.source?.title || "未知来源");
  const url = args.source?.kind === "web" ? safeWebUrl(args.source.url) : null;
  const markdownUrl = url?.replace(/\(/g, "%28").replace(/\)/g, "%29");
  const source = markdownUrl ? `[${label}](${markdownUrl})` : label;
  const quote = selection.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  return `${question}\n\n> [!selection] ${source}\n${quote}`;
}

export function parseSelectionMessage(markdown: string): SelectionMessage | null {
  const separator = markdown.indexOf("\n\n> [!selection] ");
  if (separator <= 0) return null;
  const question = markdown.slice(0, separator);
  if (question !== question.trim()) return null;
  const lines = markdown.slice(separator + 2).split("\n");
  const header = /^> \[!selection\] (.+)$/.exec(lines[0] ?? "");
  if (!header || lines.length < 2 || lines.slice(1).some((line) => !line.startsWith("> "))) return null;
  const selection = lines.slice(1).map((line) => line.slice(2)).join("\n");
  if (!selection.trim()) return null;

  const linked = /^\[((?:\\.|[^\]])+)\]\((https?:\/\/[^\s)]+)\)$/.exec(header[1]);
  if (linked) {
    const url = safeWebUrl(linked[2]);
    if (!url) return null;
    return { question, selection, source: { label: unescapeLabel(linked[1]), url } };
  }
  if (/^\[/.test(header[1])) return null;
  return { question, selection, source: { label: unescapeLabel(header[1]), url: null } };
}
