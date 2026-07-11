import type { ChangeSpec } from "@codemirror/state";
import { parseOutline, type OutlineNode } from "./outline-tree";

export interface OutlineEdit {
  changes: ChangeSpec;
  selection: { anchor: number; head?: number };
  /**
   * true = 有意吞掉此按键（不改动文档、不透传默认命令）。
   * 仅用于“到顶/越界 no-op”或“无同级前驱时阻止默认退格破坏结构”这类场景。
   * 未设（默认）= 正常应用 changes + selection。
   * 返回 null（而非带 swallow 的对象）= 透传给 CodeMirror 默认命令。
   */
  swallow?: boolean;
}

type MoveDir = "up" | "down";

interface TextLine {
  from: number;
  to: number;
  text: string;
}

function lineAt(doc: string, pos: number): TextLine {
  const safe = Math.max(0, Math.min(pos, doc.length));
  const before = doc.lastIndexOf("\n", Math.max(0, safe - 1));
  const after = doc.indexOf("\n", safe);
  const from = before === -1 ? 0 : before + 1;
  const to = after === -1 ? doc.length : after;
  return { from, to, text: doc.slice(from, to) };
}

function nodeAt(doc: string, pos: number): OutlineNode | null {
  const nodes = parseOutline(doc);
  return nodes.find((node) => pos >= node.from && pos <= node.to) ?? null;
}

function lineEndWithBreak(doc: string, to: number): number {
  return to < doc.length && doc[to] === "\n" ? to + 1 : to;
}

function headingMatch(text: string): RegExpExecArray | null {
  return /^(#{1,6})(\s+)(.*)$/.exec(text);
}

function listMatch(text: string): RegExpExecArray | null {
  return /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/.exec(text);
}

function isCardKind(kind: OutlineNode["kind"]): boolean {
  return kind.endsWith("-card");
}

function markerContentStart(line: TextLine): number {
  const list = listMatch(line.text);
  if (list) return line.from + list[1].length + list[2].length + list[3].length;
  const heading = headingMatch(line.text);
  if (heading) return line.from + heading[1].length + heading[2].length;
  return line.from;
}

function noop(pos: number): OutlineEdit {
  return { changes: { from: pos, insert: "" }, selection: { anchor: pos }, swallow: true };
}

/**
 * Enter（幕布式）：
 *  - list/heading：行中=切分当前节点（光标前留原 bullet，光标后开新同级 bullet）；
 *    行末=新建同级 bullet。两者都是“在光标处插 \n + 同缩进 marker”。
 *  - list 空 bullet（仅 marker）：Enter=退出列表（删 marker 留空行）。
 *  - para 行末：插 \n\n，空行被大纲压制 → 视觉紧贴的同级 para。
 *  - para 行中：返回 null → 透传默认换行（仍属同一 para 节点）。
 *  - card：在卡片末后插空 para 行。
 */
export function buildEnterChange(doc: string, pos: number): OutlineEdit | null {
  const node = nodeAt(doc, pos);
  if (!node) return null;
  const line = lineAt(doc, pos);

  if (isCardKind(node.kind)) {
    const insertAt = lineEndWithBreak(doc, node.to);
    const insert = "\n";
    return { changes: { from: insertAt, insert }, selection: { anchor: insertAt + insert.length } };
  }

  if (node.kind === "list") {
    const match = listMatch(line.text);
    if (!match) return null;
    const marker = `${match[1]}${match[2]} `;
    const contentStart = line.from + match[1].length + match[2].length + match[3].length;
    // 空 bullet → 退出列表
    if (line.text.slice(contentStart - line.from).trim() === "") {
      const to = lineEndWithBreak(doc, line.to);
      return { changes: { from: line.from, to, insert: "" }, selection: { anchor: line.from } };
    }
    // 行中切分 / 行末新建：都是在光标处插 \n + 同缩进 marker
    const insert = `\n${marker}`;
    return { changes: { from: pos, insert }, selection: { anchor: pos + insert.length } };
  }

  if (node.kind === "heading") {
    const hashes = "#".repeat(node.depth);
    const insert = `\n${hashes} `;
    return { changes: { from: pos, insert }, selection: { anchor: pos + insert.length } };
  }

  // para
  if (pos === node.to) {
    const insert = "\n\n";
    return { changes: { from: pos, insert }, selection: { anchor: pos + insert.length } };
  }
  return null; // 行中 → 透传默认换行
}

/**
 * Tab（幕布式）：整节点缩进由渲染层逐行 Decoration.line 负责，编辑层只改源文本的深度语法。
 *  - heading：+1 个 #，封顶 H6（到顶吞）。
 *  - list：+2 空格。
 *  - para：首行加 "- " 转 list（多行 para 仅转首行，已知限制）。
 *  - card：吞（防止破坏代码块）。
 */
export function buildIndentChange(doc: string, pos: number): OutlineEdit | null {
  const node = nodeAt(doc, pos);
  if (!node) return null;
  const line = lineAt(doc, pos);

  if (node.kind === "heading") {
    const match = headingMatch(line.text);
    if (!match || match[1].length >= 6) return noop(pos);
    return { changes: { from: line.from, insert: "#" }, selection: { anchor: pos + 1 } };
  }
  if (node.kind === "list") {
    return { changes: { from: line.from, insert: "  " }, selection: { anchor: pos + 2 } };
  }
  if (node.kind === "para") {
    return { changes: { from: line.from, insert: "- " }, selection: { anchor: pos + 2 } };
  }
  return noop(pos); // card
}

/**
 * Shift+Tab：
 *  - heading：-1 个 #，封顶 H1（到顶吞）。
 *  - list：indent≥2 去 2 空格；body 层（indent<2）→ 转回 para（去 marker）。
 *  - para/card：返回 null → 透传默认 indentLess。
 */
export function buildDedentChange(doc: string, pos: number): OutlineEdit | null {
  const node = nodeAt(doc, pos);
  if (!node) return null;
  const line = lineAt(doc, pos);

  if (node.kind === "heading") {
    const match = headingMatch(line.text);
    if (!match || match[1].length <= 1) return noop(pos);
    return {
      changes: { from: line.from, to: line.from + 1, insert: "" },
      selection: { anchor: Math.max(line.from, pos - 1) },
    };
  }
  if (node.kind !== "list") return null; // para/card → 透传
  const match = listMatch(line.text);
  if (!match) return null;
  if (match[1].length >= 2) {
    return {
      changes: { from: line.from, to: line.from + 2, insert: "" },
      selection: { anchor: Math.max(line.from, pos - 2) },
    };
  }
  // Top-level list items stay structural outline nodes. Turning them into
  // paragraphs would make them disappear from the simplified outline.
  return noop(pos);
}

/**
 * Backspace@行首：
 *  - 空节点（仅 marker / 全空白）：删行。
 *  - 非空：合并到前一个同级兄弟，光标落接缝。
 *  - 无同级前驱：吞（防止默认退格删换行、把子项并进父行破坏结构）。
 *  - 非行首：返回 null → 透传默认退格（删字符）。
 */
export function buildMergeBackChange(doc: string, pos: number): OutlineEdit | null {
  const line = lineAt(doc, pos);
  if (pos !== line.from) return null;
  const node = nodeAt(doc, pos);
  if (!node) return null;

  const contentStart = markerContentStart(line);
  if (line.text.slice(contentStart - line.from).trim() === "") {
    const to = lineEndWithBreak(doc, line.to);
    return { changes: { from: line.from, to, insert: "" }, selection: { anchor: line.from } };
  }

  const nodes = parseOutline(doc);
  const index = nodes.findIndex((candidate) => candidate.id === node.id);
  const previous = [...nodes.slice(0, index)].reverse()
    .find((candidate) => candidate.depth === node.depth);
  if (!previous) return noop(pos);

  const previousLine = lineAt(doc, previous.to);
  const anchor = previousLine.to;
  return {
    changes: { from: previousLine.to, to: contentStart, insert: " " },
    selection: { anchor },
  };
}

function subtreeRange(doc: string, node: OutlineNode): { from: number; to: number } {
  const childEnd = node.childTo > node.childFrom ? node.childTo : node.to;
  return { from: node.from, to: lineEndWithBreak(doc, childEnd) };
}

export function buildMoveSubtreeChange(
  doc: string,
  pos: number,
  dir: MoveDir,
): OutlineEdit | null {
  const node = nodeAt(doc, pos);
  if (!node) return null;
  const nodes = parseOutline(doc);
  const index = nodes.findIndex((candidate) => candidate.id === node.id);
  if (index === -1) return null;

  if (dir === "down") {
    const sibling = nodes.slice(index + 1).find((candidate) => candidate.depth === node.depth);
    if (!sibling) return null;
    const a = subtreeRange(doc, node);
    const b = subtreeRange(doc, sibling);
    if (b.from < a.to) return null;
    const aText = doc.slice(a.from, a.to);
    const between = doc.slice(a.to, b.from);
    const bText = doc.slice(b.from, b.to);
    const movedFrom = a.from + bText.length + between.length;
    return {
      changes: { from: a.from, to: b.to, insert: `${bText}${between}${aText}` },
      selection: { anchor: movedFrom + (pos - a.from) },
    };
  }

  const previous = [...nodes.slice(0, index)].reverse().find((candidate) =>
    candidate.depth === node.depth && subtreeRange(doc, candidate).to <= node.from);
  if (!previous) return null;
  const a = subtreeRange(doc, previous);
  const b = subtreeRange(doc, node);
  const aText = doc.slice(a.from, a.to);
  const between = doc.slice(a.to, b.from);
  const bText = doc.slice(b.from, b.to);
  return {
    changes: { from: a.from, to: b.to, insert: `${bText}${between}${aText}` },
    selection: { anchor: a.from + (pos - b.from) },
  };
}
