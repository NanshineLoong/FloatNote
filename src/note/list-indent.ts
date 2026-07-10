import type { SyntaxNode } from "@lezer/common";

export function isListItemLine(line: string): boolean {
  return /^\s*([-*+]|\d+\.)\s/.test(line);
}

/** Nesting depth in 4-space units. Our Tab inserts 4 spaces per level, so
 *  user-created nesting is always a multiple of 4. */
export function lineDepth(line: string): number {
  const m = /^(\s*)/.exec(line);
  return Math.floor((m ? m[1].length : 0) / 4);
}

export function outdentLine(line: string): string {
  const spaces = /^ {1,4}/.exec(line);
  if (spaces) return line.slice(spaces[0].length);
  if (/^\t/.test(line)) return line.slice(1);
  return line;
}

/** Whether Tab may demote the current item, given the immediately preceding
 *  list item's depth (null = first item, no predecessor). Allowed only when
 *  the result would be at most one level deeper than the predecessor. */
export function canDemote(prevDepth: number | null, curDepth: number): boolean {
  if (prevDepth === null) return false;
  return curDepth <= prevDepth;
}

/** 有序列表 ListMark 在其所属列表中的 1 基序号。沿父 ListItem 的
 *  prevSibling 链统计 ListItem 前驱个数 +1；不同 OrderedList 父节点之间
 *  prevSibling 链自然在边界断开 → 自动从 1 重计。无状态、按节点自洽，
 *  与源码里写什么数字无关。 */
export function olOrdinal(listMark: SyntaxNode): number {
  const item = listMark.parent;
  if (!item) return 1;
  let count = 0;
  let s = item.prevSibling;
  while (s) {
    if (s.name === "ListItem") count++;
    s = s.prevSibling;
  }
  return count + 1;
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
