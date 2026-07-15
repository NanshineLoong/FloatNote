import type {
  DecodedInbox,
  InboxMetadata,
  InboxMetadataWarning,
  QuoteSourceMetadata,
  TextAnnotation,
} from "./types";
import { isValidTagName } from "../tags/model";

const ID = "[a-z0-9-]+";
const V2_DEFS_RE = /^<!-- floatnote:tags:v2(?: (.*))? -->$/;
const LEGACY_DEFS_RE = /^<!-- floatnote-tags:.*-->$/;
const START_RE = new RegExp(`^<!-- floatnote:ann:v2 id=(${ID}) tag=(${ID}) start -->$`);
const END_RE = new RegExp(`^<!-- floatnote:ann:v2 id=(${ID}) end -->$`);
const BID_RE = /^<!-- floatnote:bid=([^>]*?) -->$/;
// FloatNote owns this comment namespace. Match loosely so damaged internal
// markers can never leak into the editable Markdown projection.
const FLOATNOTE_COMMENT_RE = /<!--\s*floatnote(?::|-tags:)[^\r\n]*?(?:-->|(?=\r?$))/gm;

function unescapeName(value: string): string {
  return value.replace(/\\([\\"])/g, "$1");
}

function escapeName(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function parseTags(line: string, warnings: InboxMetadataWarning[]) {
  const match = V2_DEFS_RE.exec(line);
  if (!match) return [];
  const tags: InboxMetadata["tags"] = [];
  const body = match[1] ?? "";
  const entryRe = new RegExp(`(${ID})="((?:\\\\.|[^"])*)"\\|c=(#[0-9a-fA-F]{3,8})(?:; |$)`, "g");
  let consumed = 0;
  let entry: RegExpExecArray | null;
  while ((entry = entryRe.exec(body)) !== null) {
    if (entry.index !== consumed) warnings.push({ code: "malformed-metadata", message: "Malformed tag definition" });
    tags.push({ id: entry[1], name: unescapeName(entry[2]), color: entry[3] });
    consumed = entryRe.lastIndex;
  }
  if (consumed !== body.length) warnings.push({ code: "malformed-metadata", message: "Malformed tag definition" });
  return tags;
}

function stripDefinitions(input: string, warnings: InboxMetadataWarning[]) {
  const withoutBom = input.startsWith("\uFEFF") ? input.slice(1) : input;
  const newline = withoutBom.indexOf("\n");
  const firstLine = (newline < 0 ? withoutBom : withoutBom.slice(0, newline)).replace(/\r$/, "");
  if (V2_DEFS_RE.test(firstLine)) {
    return { body: newline < 0 ? "" : withoutBom.slice(newline + 1), tags: parseTags(firstLine, warnings) };
  }
  if (LEGACY_DEFS_RE.test(firstLine)) {
    return { body: newline < 0 ? "" : withoutBom.slice(newline + 1), tags: [] };
  }
  if (/^<!--\s*floatnote(?::tags:v2|-tags:)/.test(firstLine)) {
    warnings.push({ code: "malformed-metadata", message: "Malformed tag definition" });
    return { body: newline < 0 ? "" : withoutBom.slice(newline + 1), tags: [] };
  }
  return { body: withoutBom, tags: [] };
}

export function decodeInbox(input: string): DecodedInbox {
  const warnings: InboxMetadataWarning[] = [];
  const stripped = stripDefinitions(input, warnings);
  const body = stripped.body;
  const clean: string[] = [];
  const starts = new Map<string, { tagId: string; from: number }>();
  const ends = new Map<string, number>();
  const invalidIds = new Set<string>();
  const quoteSources: QuoteSourceMetadata[] = [];
  let sourceOffset = 0;
  let cleanOffset = 0;
  let marker: RegExpExecArray | null;
  FLOATNOTE_COMMENT_RE.lastIndex = 0;
  while ((marker = FLOATNOTE_COMMENT_RE.exec(body)) !== null) {
    const literal = body.slice(sourceOffset, marker.index);
    clean.push(literal);
    cleanOffset += literal.length;
    const value = marker[0];
    const start = START_RE.exec(value);
    const end = END_RE.exec(value);
    const bid = BID_RE.exec(value);
    if (start) {
      if (starts.has(start[1])) {
        invalidIds.add(start[1]);
        warnings.push({ code: "duplicate-marker", message: `Duplicate start marker: ${start[1]}`, offset: cleanOffset });
      } else starts.set(start[1], { tagId: start[2], from: cleanOffset });
    } else if (end) {
      if (ends.has(end[1])) {
        invalidIds.add(end[1]);
        warnings.push({ code: "duplicate-marker", message: `Duplicate end marker: ${end[1]}`, offset: cleanOffset });
      } else ends.set(end[1], cleanOffset);
    } else if (bid) {
      const before = clean.join("");
      const lineStart = before.lastIndexOf("\n") + 1;
      quoteSources.push({ cardFrom: lineStart, bundleId: bid[1] });
    } else {
      warnings.push({ code: "malformed-metadata", message: "Malformed metadata marker", offset: cleanOffset });
    }
    sourceOffset = marker.index + value.length;
  }
  const tail = body.slice(sourceOffset);
  clean.push(tail);
  const markdown = clean.join("");
  const knownTags = new Set(stripped.tags.map((tag) => tag.id));
  const annotations: TextAnnotation[] = [];
  const ids = new Set([...starts.keys(), ...ends.keys()]);
  for (const id of ids) {
    const start = starts.get(id);
    const to = ends.get(id);
    if (!start || to === undefined) {
      warnings.push({ code: "orphan-marker", message: `Orphan annotation marker: ${id}` });
      continue;
    }
    if (invalidIds.has(id)) continue;
    if (!knownTags.has(start.tagId)) {
      warnings.push({ code: "unknown-tag", message: `Unknown annotation tag: ${start.tagId}` });
      continue;
    }
    if (start.from >= to) {
      warnings.push({ code: "invalid-range", message: `Invalid annotation range: ${id}` });
      continue;
    }
    annotations.push({ id, tagId: start.tagId, from: start.from, to });
  }
  const canonical: TextAnnotation[] = [];
  for (const tagId of knownTags) {
    const tagged = annotations
      .filter((annotation) => annotation.tagId === tagId)
      .sort((a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id));
    let previous: TextAnnotation | undefined;
    for (const annotation of tagged) {
      if (previous && annotation.from <= previous.to) previous.to = Math.max(previous.to, annotation.to);
      else {
        previous = { ...annotation };
        canonical.push(previous);
      }
    }
  }
  canonical.sort((a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id));
  return { markdown, metadata: { tags: stripped.tags, annotations: canonical, quoteSources }, warnings };
}

interface Event {
  pos: number;
  kind: "end" | "start" | "quote";
  order: number;
  id: string;
  marker: string;
}

export function encodeInbox(markdown: string, metadata: InboxMetadata): string {
  const tagOrder = new Map(metadata.tags.map((tag, index) => [tag.id, index]));
  const validTags = new Set(metadata.tags
    .filter((tag) => (
      new RegExp(`^${ID}$`).test(tag.id) &&
      isValidTagName(tag.name) &&
      /^#[0-9a-fA-F]{3,8}$/.test(tag.color)
    ))
    .map((tag) => tag.id));
  const events: Event[] = [];
  for (const annotation of metadata.annotations) {
    if (
      !new RegExp(`^${ID}$`).test(annotation.id) ||
      !validTags.has(annotation.tagId) ||
      annotation.from < 0 ||
      annotation.from >= annotation.to ||
      annotation.to > markdown.length
    ) continue;
    const order = tagOrder.get(annotation.tagId) ?? Number.MAX_SAFE_INTEGER;
    events.push({
      pos: annotation.from,
      kind: "start",
      order,
      id: annotation.id,
      marker: `<!-- floatnote:ann:v2 id=${annotation.id} tag=${annotation.tagId} start -->`,
    });
    events.push({
      pos: annotation.to,
      kind: "end",
      order,
      id: annotation.id,
      marker: `<!-- floatnote:ann:v2 id=${annotation.id} end -->`,
    });
  }
  for (const source of metadata.quoteSources) {
    if (source.cardFrom < 0 || source.cardFrom > markdown.length || !/^[A-Za-z0-9._-]+$/.test(source.bundleId)) continue;
    const lineEnd = markdown.indexOf("\n", source.cardFrom);
    events.push({
      pos: lineEnd < 0 ? markdown.length : lineEnd,
      kind: "quote",
      order: Number.MAX_SAFE_INTEGER,
      id: source.bundleId,
      marker: `<!-- floatnote:bid=${source.bundleId} -->`,
    });
  }
  const kindOrder = { end: 0, start: 1, quote: 2 } as const;
  events.sort((a, b) => a.pos - b.pos || kindOrder[a.kind] - kindOrder[b.kind] || a.order - b.order || a.id.localeCompare(b.id));
  let encoded = "";
  let offset = 0;
  for (const event of events) {
    encoded += markdown.slice(offset, event.pos) + event.marker;
    offset = event.pos;
  }
  encoded += markdown.slice(offset);
  if (metadata.tags.length === 0) return encoded;
  const defs = metadata.tags
    .filter((tag) => validTags.has(tag.id))
    .map((tag) => `${tag.id}="${escapeName(tag.name)}"|c=${tag.color}`)
    .join("; ");
  return defs ? `<!-- floatnote:tags:v2 ${defs} -->\n${encoded}` : encoded;
}
