/** Source attribution for a captured quote. `url` is null for app sources.
 *  `bundleId` is the stable app identity (e.g. "com.google.chrome"); null for
 *  legacy/unknown sources. It drives same-source merge detection and the
 *  live-rendered app icon, and is persisted per-card via a hidden bid marker. */
export type Source = {
  kind: "web" | "app";
  title: string;
  url: string | null;
  bundleId: string | null;
};

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

/** Normalise a URL for dedup/merge: lowercase, strip trailing slashes. */
function normalizeWebUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "");
}

// ── bundle-id marker ──────────────────────────────────────────────────────
// Mirrors the tag-marker convention in @floatnote/note-logic (tags/model): an inline HTML comment
// `<!-- floatnote:bid=<id> -->` on the title line. The tag decoration plugin
// hides it; parseChips / the chip-widget range strip it so it never reads as a
// chip. Persisting it per card lets the icon re-render on file reopen.

const BID_RE = /<!-- floatnote:bid=([^>]*?) -->/g;
const BID_FIRST = /<!-- floatnote:bid=([^>]*?) -->/;

/** `<!-- floatnote:bid=<id> -->`. */
export function buildBidMarker(bundleId: string): string {
  return `<!-- floatnote:bid=${bundleId} -->`;
}

/** Remove every `floatnote:bid=` marker from `s`. */
export function stripBidMarker(s: string): string {
  return s.replace(BID_RE, "");
}

/** The bundle id recorded in a card block, or null (whole-block scan). */
export function readBidMarker(blockText: string): string | null {
  const m = BID_FIRST.exec(blockText);
  return m ? m[1] : null;
}

/** Parse the chip portion of a title line (text after `> [!quote] `).
 *  Splits on ` · `; `[text](url)` -> web, else app. Lenient on malformed input.
 *  Strips any floatnote tag + bid markers first so trailing markers on the
 *  title line don't pollute the chip string. Chips themselves never carry a
 *  bundleId (it lives in the per-card bid marker); parsed chips get null. */
export function parseChips(chipsStr: string): Source[] {
  const cleaned = stripBidMarker(stripTagMarker(chipsStr));
  const chips: Source[] = [];
  for (const part of cleaned.split(" · ")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = /^\[(.*)\]\((.*)\)$/.exec(trimmed);
    if (m) {
      chips.push({ kind: "web", title: unescapeChipText(m[1]), url: m[2], bundleId: null });
    } else {
      chips.push({ kind: "app", title: unescapeChipText(trimmed), url: null, bundleId: null });
    }
  }
  return chips;
}

/** Build `> [!quote] <chips><!-- bid -->\n<quoted body>`. Null source -> empty
 *  title line and no bid marker. The bid marker is inline on the title line so
 *  it adds no extra card row and stays hidden in the live preview. */
export function buildQuoteBlock(text: string, source: Source | null): string {
  const chipsStr = source ? sourceToChip(source) : "";
  const bid = source?.bundleId ? buildBidMarker(source.bundleId) : "";
  const titleLine = `> [!quote]${chipsStr ? ` ${chipsStr}` : ""}${bid}`;
  return `${titleLine}\n${quoteBody(text)}`;
}

/** Merge `text` into an existing `[!quote]` card block. Same-source is
 *  guaranteed by the caller (`resolveMergeTarget`); this fn only appends body
 *  after a `>` blank separator and preserves the title line (and its bid
 *  marker) verbatim. Preserves the block's floatnote tag marker: strips any
 *  existing marker from the lines, then re-appends one on the new last line
 *  (whole-block scan means it stays findable). */
export function mergeQuoteBlock(existingBlock: string, text: string): string {
  const tagId = blockTagId(existingBlock);
  const lines = existingBlock.split("\n").map(stripTagMarker);
  const titleLine = lines[0] ?? "> [!quote]";

  const bodyLines = lines.slice(1);
  const newBody = bodyLines.length > 0
    ? `${bodyLines.join("\n")}\n>\n${quoteBody(text)}`
    : quoteBody(text);

  const suffix = tagId ? buildMarker(tagId) : "";
  return `${titleLine}\n${newBody}${suffix}`;
}

/** True iff the block's first line matches `^>\s*\[!quote\]`. */
export function isQuoteCardBlock(blockText: string): boolean {
  const firstLine = blockText.split("\n", 1)[0] ?? "";
  return /^>\s*\[!quote\]/.test(firstLine);
}

import { blockRanges, blockTagId, buildMarker, stripTagMarker, type BlockRange } from "@floatnote/note-logic";

export type MergeTarget =
  | { kind: "merge"; range: BlockRange }
  | { kind: "new"; at: number };

/** Extract the chips string from a card block's title line (text after
 *  `> [!quote] `), before any markers are stripped. */
function titleChipsOf(blockText: string): string {
  const firstLine = blockText.split("\n", 1)[0] ?? "";
  const m = /^>\s*\[!quote\]\s?(.*)$/.exec(firstLine);
  return m ? m[1] : "";
}

/** True iff an incoming source is "the same" as the card's source for merge
 *  purposes:
 *  • app identity: bundle id equal (title-equal fallback when either side lacks
 *    a bundle id — legacy files / sourceless captures);
 *  • web: additionally the normalised url must match. */
function sameSource(card: Source, cardBid: string | null, incoming: Source): boolean {
  const sameApp =
    cardBid && incoming.bundleId
      ? cardBid === incoming.bundleId
      : card.title === incoming.title;
  if (incoming.kind === "web") {
    return sameApp && card.kind === "web" &&
      normalizeWebUrl(card.url ?? "") === normalizeWebUrl(incoming.url ?? "");
  }
  return sameApp;
}

/** Decide whether a capture of `incoming` at `caret` should merge into an
 *  existing `[!quote]` card (inside or immediately preceding, separated only by
 *  blank lines, AND same source) or start a new card. Pure over (doc, caret,
 *  incoming) so it is unit-testable without a live CodeMirror.
 *
 *  Returns `{kind:"new", at}` where `at` is the insertion offset: the caret when
 *  there's no nearby card, or the end of the candidate card when the source
 *  differs — so different-source quotes stack as sibling blocks after the card
 *  rather than merging or splitting it. */
export function resolveMergeTarget(
  doc: string,
  caret: number,
  incoming: Source | null,
): MergeTarget {
  const ranges = blockRanges(doc);

  // Candidate card: caret inside one, or in blank lines immediately after one.
  let candidate: BlockRange | null = null;
  for (const r of ranges) {
    if (r.from <= caret && caret <= r.to && isQuoteCardBlock(doc.slice(r.from, r.to))) {
      candidate = r;
      break;
    }
  }
  if (!candidate) {
    let prev: BlockRange | null = null;
    for (const r of ranges) {
      if (r.to < caret) prev = r;
      else break;
    }
    if (prev && isQuoteCardBlock(doc.slice(prev.from, prev.to))) {
      const between = doc.slice(prev.to, caret);
      if (between.trim() === "") candidate = prev;
    }
  }

  if (!candidate) return { kind: "new", at: caret };

  if (incoming) {
    const blockText = doc.slice(candidate.from, candidate.to);
    const first = parseChips(titleChipsOf(blockText))[0];
    if (first && sameSource(first, readBidMarker(blockText), incoming)) {
      return { kind: "merge", range: candidate };
    }
  }

  // Different source (or sourceless incoming): new sibling block after the card.
  return { kind: "new", at: candidate.to };
}
