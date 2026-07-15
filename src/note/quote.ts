import type { QuoteSourceMetadata, TextChange, TextRange } from "@floatnote/note-logic";

export type Source = {
  kind: "web" | "app";
  title: string;
  url: string | null;
  bundleId: string | null;
};

export function quoteBody(text: string): string {
  return text.split("\n").map((line) => line === "" ? ">" : `> ${line}`).join("\n");
}

function escapeChipText(text: string): string {
  return text.replace(/[\[\]\\]/g, (match) => `\\${match}`);
}

function unescapeChipText(text: string): string {
  return text.replace(/\\([\[\]\\])/g, "$1");
}

export function sourceToChip(source: Source): string {
  return source.kind === "web" && source.url
    ? `[${escapeChipText(source.title)}](${source.url})`
    : escapeChipText(source.title);
}

function normalizeWebUrl(url: string): string {
  return url.toLowerCase().replace(/\/+$/, "");
}

const BID_RE = /<!-- floatnote:bid=([^>]*?) -->/g;
const BID_FIRST = /<!-- floatnote:bid=([^>]*?) -->/;

export function buildBidMarker(bundleId: string): string {
  return `<!-- floatnote:bid=${bundleId} -->`;
}

export function stripBidMarker(value: string): string {
  return value.replace(BID_RE, "");
}

export function readBidMarker(value: string): string | null {
  return BID_FIRST.exec(value)?.[1] ?? null;
}

export function parseChips(chips: string): Source[] {
  const cleaned = stripBidMarker(chips);
  const sources: Source[] = [];
  for (const part of cleaned.split(" · ")) {
    const value = part.trim();
    if (!value) continue;
    const match = /^\[(.*)\]\((.*)\)$/.exec(value);
    sources.push(match
      ? { kind: "web", title: unescapeChipText(match[1]), url: match[2], bundleId: null }
      : { kind: "app", title: unescapeChipText(value), url: null, bundleId: null });
  }
  return sources;
}

/** Build clean editor Markdown. Bundle identity is stored in InboxMetadata. */
export function buildQuoteBlock(text: string, source: Source | null): string {
  const chip = source ? sourceToChip(source) : "";
  return `> [!quote]${chip ? ` ${chip}` : ""}\n${quoteBody(text)}`;
}

export function isQuoteCardBlock(blockText: string): boolean {
  return /^>\s*\[!quote\]/.test(blockText.split("\n", 1)[0] ?? "");
}

/** Find quote cards without depending on the removed generic Inbox block model. */
export function quoteCardRanges(markdown: string): TextRange[] {
  const ranges: TextRange[] = [];
  let offset = 0;
  while (offset <= markdown.length) {
    const newline = markdown.indexOf("\n", offset);
    const lineTo = newline < 0 ? markdown.length : newline;
    const line = markdown.slice(offset, lineTo);
    if (/^>\s*\[!quote\]/.test(line)) {
      const from = offset;
      let to = lineTo;
      let next = newline < 0 ? markdown.length + 1 : newline + 1;
      while (next <= markdown.length) {
        const nextNewline = markdown.indexOf("\n", next);
        const nextTo = nextNewline < 0 ? markdown.length : nextNewline;
        if (!/^>/.test(markdown.slice(next, nextTo))) break;
        to = nextTo;
        next = nextNewline < 0 ? markdown.length + 1 : nextNewline + 1;
      }
      ranges.push({ from, to });
      offset = next;
      continue;
    }
    if (newline < 0) break;
    offset = newline + 1;
  }
  return ranges;
}

/** Append only at the body end so existing annotation positions map naturally. */
export function buildQuoteAppendChange(
  existingBlock: string,
  _cardFrom: number,
  cardTo: number,
  text: string,
): TextChange {
  const separator = existingBlock.includes("\n") ? "\n>\n" : "\n";
  return { from: cardTo, to: cardTo, insert: `${separator}${quoteBody(text)}` };
}

/** Compatibility helper for callers that only need the resulting block text. */
export function mergeQuoteBlock(existingBlock: string, text: string): string {
  const change = buildQuoteAppendChange(existingBlock, 0, existingBlock.length, text);
  return existingBlock + change.insert;
}

export type MergeTarget =
  | { kind: "merge"; range: TextRange }
  | { kind: "new"; at: number };

function titleChipsOf(blockText: string): string {
  return /^>\s*\[!quote\]\s?(.*)$/.exec(blockText.split("\n", 1)[0] ?? "")?.[1] ?? "";
}

function sameSource(card: Source, cardBundleId: string | null, incoming: Source): boolean {
  const sameIdentity = cardBundleId && incoming.bundleId
    ? cardBundleId === incoming.bundleId
    : card.title === incoming.title;
  return incoming.kind === "web"
    ? sameIdentity && card.kind === "web" &&
      normalizeWebUrl(card.url ?? "") === normalizeWebUrl(incoming.url ?? "")
    : sameIdentity && card.kind === "app";
}

export function resolveMergeTarget(
  markdown: string,
  caret: number,
  incoming: Source | null,
  quoteSources: QuoteSourceMetadata[] = [],
): MergeTarget {
  const ranges = quoteCardRanges(markdown);
  let candidate = ranges.find((range) => range.from <= caret && caret <= range.to) ?? null;
  if (!candidate) {
    const previous = [...ranges].reverse().find((range) => range.to <= caret);
    if (previous && markdown.slice(previous.to, caret).trim() === "") candidate = previous;
  }
  if (!candidate) return { kind: "new", at: caret };
  if (incoming) {
    const block = markdown.slice(candidate.from, candidate.to);
    const card = parseChips(titleChipsOf(block))[0];
    const bundleId = quoteSources.find((source) => source.cardFrom === candidate?.from)?.bundleId
      ?? readBidMarker(block);
    if (card && sameSource(card, bundleId, incoming)) return { kind: "merge", range: candidate };
  }
  return { kind: "new", at: candidate.to };
}
