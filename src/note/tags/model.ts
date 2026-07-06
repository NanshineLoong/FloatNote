/**
 * Tag model — pure logic, no DOM/CodeMirror. Tags live inside `_inbox.md` as
 * hidden HTML comments so the file stays self-contained and a tag's identity
 * travels with its block on reorder (no fragile index mapping).
 *
 * Two comment forms:
 *   • Definitions (line 1):  `<!-- floatnote-tags: <id>="<name>"|c=<hex>; ... -->`
 *   • Per-block marker:      `<!-- floatnote:tag=<id> -->` (inline, anywhere in
 *     the block; conventionally appended to the last line, but read by whole-
 *     block scan so it survives quote-merge moving it off the last line).
 *
 * Block markers store the slug `id`, never the `name` — rename/recolor only
 * rewrites line 1; the per-block markers are untouched. Deleting a tag emits
 * one set of changes (all markers + defs entry) so `⌘Z` restores everything in
 * a single undo step.
 */
import { blockRanges, type BlockRange, type ChangeOp } from "../blocks/ranges";

export interface TagDef {
  id: string;
  name: string;
  color: string; // hex, e.g. "#e5484d"
}

export type TagMap = Map<string, TagDef>;

const DEFS_RE = /^<!-- floatnote-tags: (.*) -->$/;
const ENTRY_RE = /([a-z0-9-]+)="([^"]*)"\|c=(#[0-9a-fA-F]{3,8})/g;
const MARKER_RE = /<!-- floatnote:tag=([a-z0-9-]+) -->/g;
const MARKER_FIRST = /<!-- floatnote:tag=([a-z0-9-]+) -->/;
const DEFS_LINE_RE = /^<!-- floatnote-tags:.*-->$/;

// ── defs comment ────────────────────────────────────────────────────────────

/** Parse the line-1 defs comment into a TagMap. Missing/malformed → empty. */
export function parseDefs(doc: string): TagMap {
  const nl = doc.indexOf("\n");
  const line1 = nl === -1 ? doc : doc.slice(0, nl);
  const m = DEFS_RE.exec(line1);
  if (!m) return new Map();
  const map: TagMap = new Map();
  for (const em of m[1].matchAll(ENTRY_RE)) {
    map.set(em[1], { id: em[1], name: em[2], color: em[3] });
  }
  return map;
}

/** Serialize a TagMap into the defs comment line (no trailing newline). */
export function serializeDefs(map: TagMap): string {
  const body = [...map.values()]
    .map((d) => `${d.id}="${d.name}"|c=${d.color}`)
    .join("; ");
  return `<!-- floatnote-tags: ${body} -->`;
}

/** True iff the given text line is a floatnote defs comment. */
export function isDefsLine(line: string): boolean {
  return DEFS_LINE_RE.test(line);
}

/** Range of line 1's defs comment text (excluding the newline), or null. */
function defsRange(doc: string): { from: number; to: number } | null {
  const nl = doc.indexOf("\n");
  const line1 = nl === -1 ? doc : doc.slice(0, nl);
  if (!DEFS_LINE_RE.test(line1)) return null;
  return { from: 0, to: nl === -1 ? doc.length : nl };
}

/**
 * Change that writes `map` into line 1: replace the existing defs comment, or
 * insert a new line 1; remove the line entirely when `map` is empty. Returns
 * null when there is nothing to do.
 */
export function writeDefsChange(doc: string, map: TagMap): ChangeOp | null {
  const range = defsRange(doc);
  if (map.size === 0) {
    if (!range) return null;
    // Remove the comment line + its trailing newline (range.to is the newline
    // offset, or doc.length when the comment is the whole doc).
    const to = range.to < doc.length ? range.to + 1 : range.to;
    return { from: 0, to, insert: "" };
  }
  const line = serializeDefs(map);
  if (range) return { from: range.from, to: range.to, insert: line };
  return { from: 0, to: 0, insert: `${line}\n` };
}

// ── per-block marker ────────────────────────────────────────────────────────

export function buildMarker(id: string): string {
  return `<!-- floatnote:tag=${id} -->`;
}

/** Remove every `floatnote:tag=` marker from `s` (used before chip parsing). */
export function stripTagMarker(s: string): string {
  return s.replace(MARKER_RE, "");
}

/** First tag id found anywhere in `blockText`, or null. Whole-block scan so it
 *  survives quote-merge moving the marker off the last line. */
export function blockTagId(blockText: string): string | null {
  const m = MARKER_FIRST.exec(blockText);
  return m ? m[1] : null;
}

/**
 * Change that sets, replaces, or clears the marker on a block.
 *  • `id === null` → clear (no-op if the block has no marker).
 *  • `id` set + block already has a marker → replace its id in place.
 *  • `id` set + no marker → append `<!-- floatnote:tag=id -->` at `range.to`.
 */
export function setBlockTagChange(
  doc: string,
  range: BlockRange,
  id: string | null,
): ChangeOp | null {
  const blockText = doc.slice(range.from, range.to);
  const m = MARKER_FIRST.exec(blockText);
  if (id === null) {
    if (!m) return null;
    const from = range.from + m.index;
    return { from, to: from + m[0].length, insert: "" };
  }
  const marker = buildMarker(id);
  if (m) {
    const from = range.from + m.index;
    return { from, to: from + m[0].length, insert: marker };
  }
  return { from: range.to, to: range.to, insert: marker };
}

// ── tag mutations (each returns ChangeSpec[] for one dispatch → one undo) ────

/** Add a new tag definition; returns the new id and the defs change. */
export function addTagDefChange(
  doc: string,
  name: string,
  color: string,
): { id: string | null; change: ChangeOp | null } {
  const map = parseDefs(doc);
  if (isTagColorTaken(map, color)) return { id: null, change: null };
  const id = uniqueSlug(name, [...map.keys()]);
  map.set(id, { id, name, color });
  return { id, change: writeDefsChange(doc, map) };
}

/** Add a new tag definition and assign it to `range` in one transaction. */
export function addTagAndSetBlockChanges(
  doc: string,
  range: BlockRange,
  name: string,
  color: string,
): { id: string | null; changes: ChangeOp[] } {
  const { id, change: defChange } = addTagDefChange(doc, name, color);
  if (!id) return { id: null, changes: [] };
  const blockChange = setBlockTagChange(doc, range, id);
  const changes = [defChange, blockChange]
    .filter((c): c is ChangeOp => c !== null)
    .sort((a, b) => a.from - b.from);
  return { id, changes };
}

/** Rename and/or recolor an existing tag (defs-only; markers untouched). */
export function patchTagDefChange(
  doc: string,
  id: string,
  patch: { name?: string; color?: string },
): ChangeOp | null {
  const map = parseDefs(doc);
  const def = map.get(id);
  if (!def) return null;
  if (patch.color !== undefined && isTagColorTaken(map, patch.color, id)) return null;
  if (patch.name !== undefined) def.name = patch.name;
  if (patch.color !== undefined) def.color = patch.color;
  return writeDefsChange(doc, map);
}

/** Remove a tag everywhere: delete all its block markers + the defs entry.
 *  Returned changes are sorted and non-overlapping so one dispatch = one undo. */
export function deleteTagChanges(doc: string, id: string): ChangeOp[] {
  const changes: ChangeOp[] = [];
  const re = new RegExp(
    `<!-- floatnote:tag=${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} -->`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    changes.push({ from: m.index, to: m.index + m[0].length, insert: "" });
  }
  const map = parseDefs(doc);
  map.delete(id);
  const defsChange = writeDefsChange(doc, map);
  if (defsChange) changes.push(defsChange);
  changes.sort((a, b) => a.from - b.from);
  return changes;
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Read every block's tag id in document order (null = untagged). */
export function blockTagIds(doc: string): Array<{ range: BlockRange; id: string | null }> {
  return blockRanges(doc).map((range) => ({
    range,
    id: blockTagId(doc.slice(range.from, range.to)),
  }));
}

/** True when `color` is already assigned to another tag. */
export function isTagColorTaken(map: TagMap, color: string, exceptId?: string): boolean {
  const wanted = color.toLowerCase();
  return [...map.values()].some((def) => (
    def.id !== exceptId && def.color.toLowerCase() === wanted
  ));
}

/** Slugify a tag name (`[a-z0-9-]+`); CJK / empty names fall back to `tag`. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "tag";
}

/** Slugify `name`, appending `-2`/`-3`/… to avoid colliding with `existing`. */
export function uniqueSlug(name: string, existing: string[]): string {
  const base = slugify(name);
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
