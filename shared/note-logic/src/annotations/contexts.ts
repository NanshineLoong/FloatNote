import { Autolink, parser, Strikethrough, Table, TaskList } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";
import type { TextAnnotation, TextRange } from "./types";

const markdownParser = parser.configure([Autolink, Strikethrough, Table, TaskList]);
const CONTEXT_NAMES = new Set([
  "Paragraph",
  "ATXHeading1",
  "ATXHeading2",
  "ATXHeading3",
  "ATXHeading4",
  "ATXHeading5",
  "ATXHeading6",
  "SetextHeading1",
  "SetextHeading2",
  "TableCell",
]);
const EXCLUDED_WHOLE = new Set(["InlineCode", "FencedCode", "Image", "HTMLBlock", "Comment"]);
const EXCLUDED_SYNTAX = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "LinkMark",
  "URL",
  "CodeMark",
  "ListMark",
  "QuoteMark",
  "TableDelimiter",
  "TaskMarker",
  "HTMLTag",
  "Escape",
]);

export interface MarkdownContext extends TextRange {
  eligible: TextRange[];
}

export interface AnnotationProjectionSegment extends TextRange {
  matches: TextRange[];
}

function parserInput(markdown: string): string {
  const lines = markdown.split("\n");
  let inQuote = false;
  return lines.map((line) => {
    const marker = /^([ \t]{0,3})>/.exec(line);
    if (!marker) {
      inQuote = false;
      return line;
    }
    if (!inQuote) {
      inQuote = true;
      return line;
    }
    return `${marker[1]} ${line.slice(marker[0].length)}`;
  }).join("\n");
}

function trimRange(markdown: string, range: TextRange): TextRange | null {
  let { from, to } = range;
  while (from < to && /\s/.test(markdown[from])) from += 1;
  while (to > from && /\s/.test(markdown[to - 1])) to -= 1;
  return from < to ? { from, to } : null;
}

function excludedRanges(node: SyntaxNode): TextRange[] {
  const ranges: TextRange[] = [];
  const visit = (child: SyntaxNode): void => {
    if (EXCLUDED_WHOLE.has(child.name) || EXCLUDED_SYNTAX.has(child.name)) {
      ranges.push({ from: child.from, to: child.to });
      return;
    }
    for (let nested = child.firstChild; nested; nested = nested.nextSibling) visit(nested);
  };
  for (let child = node.firstChild; child; child = child.nextSibling) visit(child);
  return ranges.sort((a, b) => a.from - b.from || a.to - b.to);
}

function subtractRanges(base: TextRange, excluded: TextRange[]): TextRange[] {
  let pieces = [base];
  for (const cut of excluded) {
    pieces = pieces.flatMap((piece) => {
      if (cut.to <= piece.from || cut.from >= piece.to) return [piece];
      const next: TextRange[] = [];
      if (piece.from < cut.from) next.push({ from: piece.from, to: cut.from });
      if (cut.to < piece.to) next.push({ from: cut.to, to: piece.to });
      return next;
    });
  }
  return pieces;
}

export function markdownContexts(markdown: string): MarkdownContext[] {
  const tree = markdownParser.parse(parserInput(markdown));
  const contexts: MarkdownContext[] = [];
  const visit = (node: SyntaxNode, insideContext: boolean): void => {
    const isContext = CONTEXT_NAMES.has(node.name);
    if (isContext && !insideContext) {
      const excluded = excludedRanges(node);
      const source = markdown.slice(node.from, node.to);
      const quoteMarker = /(^|\n)([ \t]{0,3})> ?/g;
      let marker: RegExpExecArray | null;
      while ((marker = quoteMarker.exec(source)) !== null) {
        const from = node.from + marker.index + marker[1].length + marker[2].length;
        excluded.push({ from, to: from + marker[0].length - marker[1].length - marker[2].length });
      }
      if (node.name === "Paragraph" && /^\[!quote\](?:\s|$)/.test(markdown.slice(node.from))) {
        const titleEnd = markdown.indexOf("\n", node.from);
        excluded.push({ from: node.from, to: titleEnd < 0 ? node.to : titleEnd + 1 });
      }
      const eligible = subtractRanges({ from: node.from, to: node.to }, excluded)
        .map((range) => trimRange(markdown, range))
        .filter((range): range is TextRange => range !== null);
      if (eligible.length > 0) {
        contexts.push({
          from: Math.min(...eligible.map((range) => range.from)),
          to: Math.max(...eligible.map((range) => range.to)),
          eligible,
        });
      }
      return;
    }
    if (EXCLUDED_WHOLE.has(node.name)) return;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child, insideContext || isContext);
    }
  };
  visit(tree.topNode, false);
  return contexts.sort((a, b) => a.from - b.from || a.to - b.to);
}

export function eligibleSelectionRanges(markdown: string, selection: TextRange): TextRange[] {
  const ranges: TextRange[] = [];
  for (const context of markdownContexts(markdown)) {
    for (const eligible of context.eligible) {
      const intersection = trimRange(markdown, {
        from: Math.max(selection.from, eligible.from),
        to: Math.min(selection.to, eligible.to),
      });
      if (intersection) ranges.push(intersection);
    }
  }
  return ranges;
}

export function annotationProjection(
  markdown: string,
  annotations: TextAnnotation[],
  tagId: string,
): AnnotationProjectionSegment[] {
  const matching = annotations
    .filter((annotation) => annotation.tagId === tagId)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const segments: AnnotationProjectionSegment[] = [];
  for (const context of markdownContexts(markdown)) {
    const matches = matching
      .filter((annotation) => annotation.from >= context.from && annotation.to <= context.to)
      .map(({ from, to }) => ({ from, to }));
    if (matches.length > 0) segments.push({ from: context.from, to: context.to, matches });
  }
  return segments;
}
