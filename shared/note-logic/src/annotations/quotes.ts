import { mapPoint } from "./ranges";
import type { QuoteSourceMetadata, TextChange } from "./types";

function lineStartAt(markdown: string, position: number): number {
  return markdown.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
}

function titleLineEnd(markdown: string, from: number): number {
  const newline = markdown.indexOf("\n", from);
  return newline < 0 ? markdown.length : newline;
}

function quoteTitleStarts(markdown: string, from: number, to: number): number[] {
  const starts: number[] = [];
  let lineFrom = lineStartAt(markdown, from);
  while (lineFrom <= to && lineFrom <= markdown.length) {
    const lineTo = titleLineEnd(markdown, lineFrom);
    if (lineTo >= from && /^>\s*\[!quote\]/.test(markdown.slice(lineFrom, lineTo))) starts.push(lineFrom);
    if (lineTo === markdown.length) break;
    lineFrom = lineTo + 1;
  }
  return starts;
}

/** Re-anchor source identity to a surviving quote title after document changes. */
export function mapQuoteSources(
  oldMarkdown: string,
  newMarkdown: string,
  sources: QuoteSourceMetadata[],
  changes: TextChange[],
): QuoteSourceMetadata[] {
  return sources.flatMap((source) => {
    const oldFrom = lineStartAt(oldMarkdown, source.cardFrom);
    const oldTo = titleLineEnd(oldMarkdown, oldFrom);
    const searchFrom = mapPoint(oldFrom, changes, -1);
    const searchTo = mapPoint(oldTo, changes, 1);
    if (searchFrom >= searchTo) return [];
    const anchor = mapPoint(oldFrom, changes, 1);
    const candidates = quoteTitleStarts(newMarkdown, searchFrom, searchTo);
    if (candidates.length === 0) return [];
    const cardFrom = candidates.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor))[0];
    return [{ ...source, cardFrom }];
  });
}
