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

// ── Offset-aware parse (for WYSIWYG cell editing) ──────────────────────────

/** A single cell's trimmed text plus its char span in the table source.
 *  `from`/`to` are offsets relative to the start of the `src` passed to
 *  `parseGfmTableOffsets`; the caller adds the table node's `node.from` to
 *  get document offsets. The span covers only the trimmed cell content (not
 *  the surrounding pipes or whitespace), so replacing [from,to] with new text
 *  edits exactly that cell. */
export interface CellRange {
  text: string;
  from: number;
  to: number;
}

export interface ParsedTableOffsets {
  aligns: Align[];
  header: CellRange[];
  rows: CellRange[][];
  /** Span of the delimiter (`|---|---|`) row, for hiding/styling. */
  delimiter: { from: number; to: number };
}

/**
 * Parse a row line into cells with source spans. Mirrors `splitRow`'s
 * pipe-handling (optional leading/trailing pipe, split on `|`, per-cell trim)
 * but preserves each cell's content range. `lineStart` is the offset of the
 * line's first character within `src`.
 */
function rowCells(line: string, lineStart: number): CellRange[] {
  // Drop an optional leading pipe (and any whitespace before it).
  const lead = /^\s*\|/.exec(line);
  const bodyStart = lead ? lead[0].length : 0;
  const body = line.slice(bodyStart);
  // Drop an optional trailing pipe (and any whitespace after it).
  const trail = /\|\s*$/.exec(body);
  const middle = trail ? body.slice(0, trail.index) : body;

  const base = lineStart + bodyStart;
  const cells: CellRange[] = [];
  let segStart = 0;
  for (let i = 0; i <= middle.length; i++) {
    if (i === middle.length || (middle[i] === "|" && middle[i - 1] !== "\\")) {
      const seg = middle.slice(segStart, i);
      const leadWs = /^\s*/.exec(seg)![0].length;
      const trailWs = /\s*$/.exec(seg)![0].length;
      const contentStart = base + segStart + leadWs;
      const contentLen = seg.length - leadWs - trailWs;
      cells.push({
        text: seg.slice(leadWs, seg.length - trailWs),
        from: contentStart,
        to: contentStart + Math.max(0, contentLen),
      });
      segStart = i + 1;
    }
  }
  return cells;
}

/** Like `parseGfmTable` but every cell carries its source span, for cell-level
 *  WYSIWYG editing. Returns null if `src` is not a valid table. Offsets are
 *  relative to `src`; add the table node's `node.from` for doc offsets.
 *  Does not support escaped `\|` (an escaped pipe splits like a normal one,
 *  matching `parseGfmTable`). */
export function parseGfmTableOffsets(src: string): ParsedTableOffsets | null {
  // Compute line starts over the raw src (do NOT trim src — offsets must map
  // to the exact bytes the caller passes). A trailing empty line (if node.to
  // landed after a newline) is ignored.
  const lines = src.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const lineStart: number[] = [];
  let off = 0;
  for (const l of lines) {
    lineStart.push(off);
    off += l.length + 1; // +1 for the "\n"
  }

  if (lines.length < 2) return null;
  const header = rowCells(lines[0], lineStart[0]);
  const delim = rowCells(lines[1], lineStart[1]);
  if (!delim.every((c) => isDelimiter(c.text))) return null;
  const aligns = delim.map((c) => parseAlign(c.text));
  const rows: CellRange[][] = [];
  for (let r = 2; r < lines.length; r++) {
    rows.push(rowCells(lines[r], lineStart[r]));
  }
  const last = lineStart[1] + lines[1].length;
  return {
    aligns,
    header,
    rows,
    delimiter: { from: lineStart[1], to: last },
  };
}

