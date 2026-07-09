export type Align = "left" | "right" | "center" | "none";

export interface ParsedTable {
  aligns: Align[];
  header: string[];
  rows: string[][];
}

function splitRow(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((c) => c.trim());
}

function parseAlign(cell: string): Align {
  const t = cell.trim();
  const left = t.startsWith(":");
  const right = t.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

function isDelimiter(cell: string): boolean {
  return /^:?-+:?$/.test(cell.trim());
}

/** Parse a GFM pipe table. Returns null if `src` is not a valid table
 *  (e.g. missing the delimiter row). Does not support escaped `\|`. */
export function parseGfmTable(src: string): ParsedTable | null {
  const lines = src.trim().split("\n").map((l) => l.trim());
  if (lines.length < 2) return null;
  const header = splitRow(lines[0]);
  const delim = splitRow(lines[1]);
  if (!delim.every(isDelimiter)) return null;
  const aligns = delim.map(parseAlign);
  const rows = lines.slice(2).map(splitRow);
  return { aligns, header, rows };
}
