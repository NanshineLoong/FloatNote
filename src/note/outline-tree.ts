export type OutlineKind =
  | "heading"
  | "list"
  | "para"
  | "code-card"
  | "table-card"
  | "quote-card"
  | "image-card"
  | "hr-card";

export interface OutlineNode {
  id: string;
  fallbackId: string;
  from: number;
  to: number;
  /** 节点覆盖的首个源行号（1-based）。 */
  lineFrom: number;
  /** 节点覆盖的末个源行号（1-based）。节点行成员始终是连续区间。 */
  lineTo: number;
  depth: number;
  kind: OutlineKind;
  text: string;
  childFrom: number;
  childTo: number;
  siblingOrdinal: number;
}

interface SourceLine {
  number: number;
  from: number;
  to: number;
  text: string;
}

interface DraftNode {
  from: number;
  to: number;
  lineFrom: number;
  lineTo: number;
  depth: number;
  kind: OutlineKind;
  text: string;
}

function linesOf(doc: string): SourceLine[] {
  if (doc.length === 0) return [];
  const lines: SourceLine[] = [];
  let from = 0;
  let number = 1;
  while (from <= doc.length) {
    const nl = doc.indexOf("\n", from);
    const to = nl === -1 ? doc.length : nl;
    lines.push({ number, from, to, text: doc.slice(from, to) });
    if (nl === -1) break;
    from = nl + 1;
    number++;
  }
  return lines;
}

function endWithLineBreak(doc: string, to: number): number {
  return to < doc.length && doc[to] === "\n" ? to + 1 : to;
}

/** 每个源行起始偏移（含末行=doc.length）。供 buildDecorations 逐行扫描空行用。 */
export function lineStartsOf(doc: string): number[] {
  if (doc.length === 0) return [];
  const starts: number[] = [0];
  for (let i = 0; i < doc.length; i++) {
    if (doc[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function headingOf(line: string): { level: number; text: string } | null {
  const match = /^(#{1,6})\s+(.*)$/.exec(line);
  if (!match) return null;
  return { level: match[1].length, text: normalizeText(match[2].replace(/\s+#+\s*$/, "")) };
}

function listOf(line: string): { indent: number; text: string } | null {
  const match = /^(\s*)([-*+])\s+(.*)$/.exec(line);
  if (!match) return null;
  return {
    indent: match[1].length,
    text: normalizeText(match[3].replace(/^\[[ xX]\]\s+/, "")),
  };
}

function isFenceStart(line: string): { marker: string; lang: string } | null {
  const match = /^\s*(```+|~~~+)\s*([^`]*)$/.exec(line);
  if (!match) return null;
  return { marker: match[1][0], lang: match[2].trim() };
}

function isFenceEnd(line: string, marker: string): boolean {
  return new RegExp(`^\\s*${marker === "`" ? "```" : "~~~"}+\\s*$`).test(line);
}

function isTableStart(lines: SourceLine[], index: number): boolean {
  const cur = lines[index]?.text ?? "";
  const next = lines[index + 1]?.text ?? "";
  return cur.includes("|") && /^\s*\|?[\s\-:]+\|[\s\-:|]*$/.test(next);
}

function tableSize(block: string): { rows: number; cols: number } {
  const rows = block.trim().split("\n").filter((line) =>
    line.includes("|") && !/^\s*\|?[\s\-:]+\|[\s\-:|]*$/.test(line));
  const cols = rows[0]?.replace(/^\||\|$/g, "").split("|").length ?? 0;
  return { rows: rows.length, cols };
}

function isQuote(line: string): boolean {
  return /^\s*>/.test(line);
}

function quoteText(block: string): string {
  const first = block.split("\n")[0] ?? "";
  const match = /^\s*>\s*\[!quote\]\s*(.*)$/.exec(first);
  const label = normalizeText(match?.[1] ?? "");
  return label ? `引用 · ${label}` : "引用";
}

function isImage(line: string): { alt: string } | null {
  const match = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
  return match ? { alt: normalizeText(match[1]) || "图片" } : null;
}

function isHr(line: string): boolean {
  return /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

function isOrdinaryText(line: string): boolean {
  return line.trim() !== "" &&
    !headingOf(line) &&
    !listOf(line) &&
    !isFenceStart(line) &&
    !isQuote(line) &&
    !isImage(line) &&
    !isHr(line);
}

function withIdentity(doc: string, drafts: DraftNode[]): OutlineNode[] {
  const parentStack: string[] = [];
  const siblingCounts = new Map<string, number>();
  const nodes: OutlineNode[] = drafts.map((draft) => {
    parentStack.length = Math.max(0, draft.depth - 1);
    const parent = parentStack[draft.depth - 2] ?? "root";
    const normalized = normalizeText(draft.text);
    const siblingKey = `${parent}|${draft.kind}|${draft.depth}|${normalized}`;
    const siblingOrdinal = siblingCounts.get(siblingKey) ?? 0;
    siblingCounts.set(siblingKey, siblingOrdinal + 1);
    const fallbackId = `${parent}|${draft.kind}|${draft.depth}|${normalized}|${siblingOrdinal}`;
    const id = `${draft.kind}:${draft.depth}:${draft.from}:${siblingOrdinal}:${normalized}`;
    parentStack[draft.depth - 1] = fallbackId;
    return {
      ...draft,
      id,
      fallbackId,
      childFrom: endWithLineBreak(doc, draft.to),
      childTo: endWithLineBreak(doc, draft.to),
      siblingOrdinal,
    };  });

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    let childTo = doc.length;
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[j].depth <= node.depth) {
        childTo = nodes[j].from;
        if (childTo > 0 && doc[childTo - 1] === "\n") childTo--;
        break;
      }
    }
    node.childTo = Math.max(node.childFrom, childTo);
  }

  return nodes;
}

export function parseOutline(doc: string): OutlineNode[] {
  const lines = linesOf(doc);
  const drafts: DraftNode[] = [];
  let headingDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.text.trim() === "") continue;

    const heading = headingOf(line.text);
    if (heading) {
      headingDepth = heading.level;
      drafts.push({
        from: line.from,
        to: line.to,
        lineFrom: line.number,
        lineTo: line.number,
        depth: heading.level,
        kind: "heading",
        text: heading.text,
      });
      continue;
    }

    const list = listOf(line.text);
    if (list) {
      drafts.push({
        from: line.from,
        to: line.to,
        lineFrom: line.number,
        lineTo: line.number,
        depth: headingDepth + 1 + Math.floor(list.indent / 2),
        kind: "list",
        text: list.text,
      });
      continue;
    }

    const fence = isFenceStart(line.text);
    if (fence) {
      let end = line;
      while (i + 1 < lines.length) {
        i++;
        end = lines[i];
        if (isFenceEnd(end.text, fence.marker)) break;
      }
      const count = end.number - line.number + 1;
      drafts.push({
        from: line.from,
        to: end.to,
        lineFrom: line.number,
        lineTo: end.number,
        depth: headingDepth + 1,
        kind: "code-card",
        text: `代码 · ${fence.lang || "text"} · ${count} 行`,
      });
      continue;
    }

    if (isTableStart(lines, i)) {
      let end = lines[i + 1];
      i++;
      while (i + 1 < lines.length && lines[i + 1].text.includes("|") &&
          lines[i + 1].text.trim() !== "") {
        i++;
        end = lines[i];
      }
      const { rows, cols } = tableSize(doc.slice(line.from, end.to));
      drafts.push({
        from: line.from,
        to: end.to,
        lineFrom: line.number,
        lineTo: end.number,
        depth: headingDepth + 1,
        kind: "table-card",
        text: `表格 · ${rows}x${cols}`,
      });
      continue;
    }

    if (isQuote(line.text)) {
      let end = line;
      while (i + 1 < lines.length && isQuote(lines[i + 1].text)) {
        i++;
        end = lines[i];
      }
      drafts.push({
        from: line.from,
        to: end.to,
        lineFrom: line.number,
        lineTo: end.number,
        depth: headingDepth + 1,
        kind: "quote-card",
        text: quoteText(doc.slice(line.from, end.to)),
      });
      continue;
    }

    const image = isImage(line.text);
    if (image) {
      drafts.push({
        from: line.from,
        to: line.to,
        lineFrom: line.number,
        lineTo: line.number,
        depth: headingDepth + 1,
        kind: "image-card",
        text: image.alt,
      });
      continue;
    }

    if (isHr(line.text)) {
      drafts.push({
        from: line.from,
        to: line.to,
        lineFrom: line.number,
        lineTo: line.number,
        depth: headingDepth + 1,
        kind: "hr-card",
        text: "分隔线",
      });
      continue;
    }

    if (isOrdinaryText(line.text)) {
      let end = line;
      const parts = [line.text.trim()];
      while (i + 1 < lines.length && isOrdinaryText(lines[i + 1].text) &&
          !isTableStart(lines, i + 1)) {
        i++;
        end = lines[i];
        parts.push(end.text.trim());
      }
      drafts.push({
        from: line.from,
        to: end.to,
        lineFrom: line.number,
        lineTo: end.number,
        depth: headingDepth + 1,
        kind: "para",
        text: normalizeText(parts.join(" ")),
      });
    }
  }

  return withIdentity(doc, drafts);
}
