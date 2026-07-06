/** Source attribution for a captured quote. `url` is null for app sources. */
export type Source = { kind: "web" | "app"; title: string; url: string | null };

/** Mirror of the old Rust `quote::format_quote`: line-by-line `> ` prefix,
 *  blank line -> bare `>`. Input is assumed trimmed (capture trims it). */
export function quoteBody(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n");
}

/** Escape `[`, `]`, `\` in chip text so it is safe inside a markdown link. */
function escapeChipText(text: string): string {
  return text.replace(/[\[\]\\]/g, (m) => `\\${m}`);
}

/** Inverse of escapeChipText. */
function unescapeChipText(text: string): string {
  return text.replace(/\\([\[\]\\])/g, "$1");
}

/** `[title](url)` for web (with url), bare `title` for app or web-without-url. */
export function sourceToChip(source: Source): string {
  if (source.kind === "web" && source.url) {
    return `[${escapeChipText(source.title)}](${source.url})`;
  }
  return escapeChipText(source.title);
}

/** Normalise a URL for dedup: lowercase, strip trailing slashes. */
function normalizeWebUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "");
}

/** True if `existing` already contains a chip matching `source` (dedup rules). */
function hasChip(existing: Source[], source: Source): boolean {
  if (source.kind === "web") {
    const u = normalizeWebUrl(source.url ?? "");
    return existing.some((c) => c.kind === "web" && normalizeWebUrl(c.url ?? "") === u);
  }
  return existing.some((c) => c.kind === "app" && c.title === source.title);
}

/** Parse the chip portion of a title line (text after `> [!quote] `).
 *  Splits on ` · `; `[text](url)` -> web, else app. Lenient on malformed input.
 *  Strips any floatnote tag marker first so a single-line tagged callout's
 *  trailing marker doesn't pollute the chip string. */
export function parseChips(chipsStr: string): Source[] {
  const cleaned = stripTagMarker(chipsStr);
  const chips: Source[] = [];
  for (const part of cleaned.split(" · ")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = /^\[(.*)\]\((.*)\)$/.exec(trimmed);
    if (m) {
      chips.push({ kind: "web", title: unescapeChipText(m[1]), url: m[2] });
    } else {
      chips.push({ kind: "app", title: unescapeChipText(trimmed), url: null });
    }
  }
  return chips;
}

/** Build `> [!quote] <chips>\n<quoted body>`. Null source -> empty title line. */
export function buildQuoteBlock(text: string, source: Source | null): string {
  const chipsStr = source ? sourceToChip(source) : "";
  const titleLine = `> [!quote]${chipsStr ? ` ${chipsStr}` : ""}`;
  return `${titleLine}\n${quoteBody(text)}`;
}

/** Merge `text` (and optionally a new `source` chip) into an existing `[!quote]`
 *  card block. Appends body after a `>` blank separator; adds chip if not a dup.
 *  Preserves existing body and chip order, and preserves the block's floatnote
 *  tag marker: strips any existing marker from the lines, then re-appends one
 *  on the new last line (whole-block scan means it stays findable). */
export function mergeQuoteBlock(
  existingBlock: string,
  text: string,
  source: Source | null,
): string {
  const tagId = blockTagId(existingBlock);
  const lines = existingBlock.split("\n").map(stripTagMarker);
  const titleLine = lines[0] ?? "> [!quote]";
  const headerMatch = /^>\s*\[!quote\]\s?(.*)$/.exec(titleLine);
  let chips = parseChips(headerMatch ? headerMatch[1] : "");
  if (source && !hasChip(chips, source)) chips = [...chips, source];

  const chipsStr = chips.map(sourceToChip).join(" · ");
  const newTitleLine = `> [!quote]${chipsStr ? ` ${chipsStr}` : ""}`;

  const bodyLines = lines.slice(1);
  const newBody = bodyLines.length > 0
    ? `${bodyLines.join("\n")}\n>\n${quoteBody(text)}`
    : quoteBody(text);

  const suffix = tagId ? buildMarker(tagId) : "";
  return `${newTitleLine}\n${newBody}${suffix}`;
}

/** True iff the block's first line matches `^>\s*\[!quote\]`. */
export function isQuoteCardBlock(blockText: string): boolean {
  const firstLine = blockText.split("\n", 1)[0] ?? "";
  return /^>\s*\[!quote\]/.test(firstLine);
}

import { blockRanges, type BlockRange } from "./blocks/ranges";
import { blockTagId, buildMarker, stripTagMarker } from "./tags/model";

export type MergeTarget =
  | { kind: "merge"; range: BlockRange }
  | { kind: "new" };

/** Decide whether a capture at `caret` should merge into an existing `[!quote]`
 *  card (inside or immediately preceding, separated only by blank lines) or
 *  start a new card. Pure over (doc, caret) so it is unit-testable without a
 *  live CodeMirror. */
export function resolveMergeTarget(doc: string, caret: number): MergeTarget {
  const ranges = blockRanges(doc);

  // Inside case: caret within a quote-card block.
  for (const r of ranges) {
    if (r.from <= caret && caret <= r.to && isQuoteCardBlock(doc.slice(r.from, r.to))) {
      return { kind: "merge", range: r };
    }
  }

  // Adjacent case: the nearest preceding block is a quote card and only
  // whitespace separates its end from the caret.
  let prev: BlockRange | null = null;
  for (const r of ranges) {
    if (r.to < caret) prev = r;
    else break;
  }
  if (prev && isQuoteCardBlock(doc.slice(prev.from, prev.to))) {
    const between = doc.slice(prev.to, caret);
    if (between.trim() === "") {
      return { kind: "merge", range: prev };
    }
  }

  return { kind: "new" };
}
