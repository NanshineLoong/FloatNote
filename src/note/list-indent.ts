import type { SyntaxNode } from "@lezer/common";
import { parser } from "@lezer/markdown";

export function isListItemLine(line: string): boolean {
  return /^\s*([-*+]|\d+\.)\s/.test(line);
}

/** Nesting depth in 4-space units. Our Tab inserts 4 spaces per level, so
 *  user-created nesting is always a multiple of 4. */
export function lineDepth(line: string): number {
  return Math.floor(leadingColumns(line) / 4);
}

export function outdentLine(line: string): string {
  const prefix = /^[ \t]*/.exec(line)?.[0] ?? "";
  const columns = leadingColumns(prefix);
  if (columns === 0) return line;
  return `${" ".repeat(Math.max(0, columns - 4))}${line.slice(prefix.length)}`;
}

/** Visual leading columns with four-column tab stops. */
export function leadingColumns(line: string): number {
  const prefix = /^[ \t]*/.exec(line)?.[0] ?? "";
  let columns = 0;
  for (const ch of prefix) columns = ch === "\t" ? columns + (4 - (columns % 4)) : columns + 1;
  return columns;
}

function withIndentColumns(line: string, columns: number): string {
  const prefix = /^[ \t]*/.exec(line)?.[0] ?? "";
  return `${" ".repeat(Math.max(0, columns))}${line.slice(prefix.length)}`;
}

/** Whether Tab may demote the current item, given the immediately preceding
 *  list item's depth (null = first item, no predecessor). Allowed only when
 *  the result would be at most one level deeper than the predecessor. */
export function canDemote(prevDepth: number | null, curDepth: number): boolean {
  if (prevDepth === null) return false;
  return curDepth <= prevDepth;
}

/** Stateful O(1) ordinal lookup for callers already walking a syntax tree in
 * document order. Counters are isolated per OrderedList container. */
export function orderedListOrdinalCounter(): (listMark: SyntaxNode) => number {
  const counters = new Map<string, number>();
  return (listMark) => {
    const item = listMark.parent;
    const list = item?.parent;
    if (item?.name !== "ListItem" || list?.name !== "OrderedList") return 1;
    const key = `${list.from}:${list.to}`;
    const ordinal = (counters.get(key) ?? 0) + 1;
    counters.set(key, ordinal);
    return ordinal;
  };
}

/** Source edits that synchronize ordered-list markers with the parsed list
 * hierarchy while preserving each marker's delimiter (`.` or `)`). */
export function orderedListMarkerChanges(source: string): Array<{ from: number; to: number; insert: string }> {
  if (!/\d+[.)][ \t]/.test(source)) return [];
  const changes: Array<{ from: number; to: number; insert: string }> = [];
  const tree = parser.parse(source);
  const nextOrdinal = orderedListOrdinalCounter();
  tree.iterate({
    enter(node) {
      if (node.name !== "ListMark" || node.node.parent?.parent?.name !== "OrderedList") return;
      const marker = source.slice(node.from, node.to);
      const match = /^(\d+)([.)])$/.exec(marker);
      if (!match) return;
      const insert = `${nextOrdinal(node.node)}${match[2]}`;
      if (insert !== marker) changes.push({ from: node.from, to: node.to, insert });
    },
  });
  return changes;
}

/** Rewrites ordered-list source markers to the ordinal implied by the Markdown
 * tree. This keeps the editable source in sync after an item is indented or
 * outdented, while preserving each marker's delimiter (`.` or `)`). */
export function renumberOrderedListMarkers(source: string): string {
  const changes = orderedListMarkerChanges(source);
  for (let i = changes.length - 1; i >= 0; i--) {
    const change = changes[i];
    source = `${source.slice(0, change.from)}${change.insert}${source.slice(change.to)}`;
  }
  return source;
}

/** Depth of the nearest preceding list line. `index` is the current line's
 *  0-based index. Skips blank lines; returns null if a non-blank non-list line
 *  is hit first, or at the top of the document. */
export function prevListItemDepth(lines: string[], index: number): number | null {
  for (let i = index - 1; i >= 0; i--) {
    const t = lines[i];
    if (t.trim() === "") continue;
    if (isListItemLine(t)) return lineDepth(t);
    return null;
  }
  return null;
}

/** Last line index owned by a list item, including all more-deeply indented
 * descendants. Blank lines inside the subtree are retained, but the first
 * non-list line or list item at the same/shallower depth closes the subtree. */
export function listSubtreeEnd(lines: string[], index: number): number {
  if (!isListItemLine(lines[index] ?? "")) return index;
  const depth = lineDepth(lines[index]);
  let end = index;
  for (let i = index + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      end = i;
      continue;
    }
    if (isListItemLine(line)) {
      if (lineDepth(line) <= depth) break;
      end = i;
      continue;
    }
    // Markdown continuation paragraphs and fenced content belong to the list
    // item when their visual indentation is deeper than the item's marker.
    if (leadingColumns(line) <= depth * 4) break;
    end = i;
  }
  return end;
}

/** Pure line transform used by the keymap. When the last selected line is a
 * list item, its descendant subtree is included so hierarchy cannot split. */
export function transformIndentRange(
  lines: string[],
  start: number,
  end: number,
  direction: "indent" | "outdent",
): string[] {
  const next = [...lines];
  const last = isListItemLine(lines[end] ?? "") ? listSubtreeEnd(lines, end) : end;
  for (let i = start; i <= last && i < next.length; i++) {
    if (direction === "indent") {
      if (next[i].trim() !== "") next[i] = withIndentColumns(next[i], leadingColumns(next[i]) + 4);
    } else {
      next[i] = outdentLine(next[i]);
    }
  }
  return next;
}
