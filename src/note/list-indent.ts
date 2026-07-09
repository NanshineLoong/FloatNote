const INDENT = "    "; // 4 spaces

export function isListItemLine(line: string): boolean {
  return /^\s*([-*+]|\d+\.)\s/.test(line);
}

/** Nesting depth in 4-space units. Our Tab inserts 4 spaces per level, so
 *  user-created nesting is always a multiple of 4. */
export function lineDepth(line: string): number {
  const m = /^(\s*)/.exec(line);
  return Math.floor((m ? m[1].length : 0) / 4);
}

export function indentLine(line: string): string {
  return INDENT + line;
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
