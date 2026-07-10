/**
 * Block-range geometry over the live `_inbox.md` text. A "block" is the same
 * grouping the old card view used — blank-line-separated paragraphs, each `- [ ]`
 * todo as its own block, each `>`/callout run as one block — but expressed as
 * char offsets into the document so the gutter handle can place itself, reorder,
 * and delete blocks via targeted CodeMirror transactions (no full re-serialize).
 */
export interface BlockRange {
  /** Offset of the block's first character (always a line start). */
  from: number;
  /** Offset just past the block's last character (no trailing newline). */
  to: number;
}

/** Change op compatible with CodeMirror's `ChangeSpec` array form. */
export interface ChangeOp {
  from: number;
  to: number;
  insert: string;
}

/** Apply a single change op to a document string, returning the new text. */
export function applyChange(doc: string, c: ChangeOp): string {
  return doc.slice(0, c.from) + c.insert + doc.slice(c.to);
}

/** Apply a batch of change ops to a document string. Ops are applied from
 *  highest `from` to lowest so earlier offsets stay valid as later spans are
 *  removed/inserted. */
export function applyChanges(doc: string, cs: ChangeOp[]): string {
  let out = doc;
  for (const c of [...cs].sort((a, b) => b.from - a.from)) out = applyChange(out, c);
  return out;
}

const TODO_RE = /^- \[[ xX]\]/;

/** Compute the char-range of every top-level block, in document order. */
export function blockRanges(text: string): BlockRange[] {
  const lines = text.split("\n");
  const lineStart: number[] = [];
  let offset = 0;
  for (let k = 0; k < lines.length; k++) {
    lineStart[k] = offset;
    offset += lines[k].length + 1; // +1 for the "\n" that split() dropped
  }

  const ranges: BlockRange[] = [];
  const endOf = (lineIdx: number) => lineStart[lineIdx] + lines[lineIdx].length;
  let i = 0;

  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i++;
      continue;
    }

    // The floatnote tag-definitions comment lives on line 1 and is hidden by
    // the tag decoration plugin; it must not count as a block (no handle, no
    // tint, can't be reordered/deleted). Only line 1 is special — per-block
    // markers live inside real blocks and travel with them.
    if (i === 0 && /^<!-- floatnote-tags:.*-->$/.test(lines[i])) {
      i++;
      continue;
    }

    const from = lineStart[i];

    if (TODO_RE.test(lines[i])) {
      ranges.push({ from, to: endOf(i) });
      i++;
      continue;
    }

    if (lines[i].startsWith(">")) {
      let j = i;
      while (j < lines.length && lines[j].startsWith(">")) j++;
      ranges.push({ from, to: endOf(j - 1) });
      i = j;
      continue;
    }

    let j = i;
    while (
      j < lines.length &&
      lines[j].trim() !== "" &&
      !lines[j].startsWith(">") &&
      !TODO_RE.test(lines[j])
    ) {
      j++;
    }
    ranges.push({ from, to: endOf(j - 1) });
    i = j;
  }

  return ranges;
}

/**
 * Changes that move block `from` to insertion index `to` (an index into the
 * ORIGINAL range array, 0..length — matching the drop logic that counts how many
 * blocks sit above the pointer). Emits a delete of the source span (with one
 * separator) plus an insert at the target boundary; the two never overlap, so
 * everything else in the doc — cursor, undo history, manual blank lines — stays
 * byte-identical. A no-op move returns `[]`.
 */
export function moveBlockChanges(
  text: string,
  ranges: BlockRange[],
  from: number,
  to: number,
): ChangeOp[] {
  if (from < 0 || from >= ranges.length) return [];
  if (to === from || to === from + 1) return [];

  const src = ranges[from];
  const blockText = text.slice(src.from, src.to);

  let delFrom: number;
  let delTo: number;
  if (from < ranges.length - 1) {
    delFrom = src.from;
    delTo = ranges[from + 1].from; // swallow the separator after the block
  } else {
    delFrom = ranges[from - 1].to; // last block: swallow the separator before it
    delTo = src.to;
  }

  let insertPos: number;
  let insertText: string;
  if (to >= ranges.length) {
    insertPos = text.length;
    insertText = `\n\n${blockText}`;
  } else {
    insertPos = ranges[to].from;
    insertText = `${blockText}\n\n`;
  }

  return [
    { from: delFrom, to: delTo, insert: "" },
    { from: insertPos, to: insertPos, insert: insertText },
  ];
}

/** Change that removes block `index` along with one adjacent separator. */
export function removeBlockChanges(ranges: BlockRange[], index: number): ChangeOp[] {
  const block = ranges[index];
  if (!block) return [];

  let from: number;
  let to: number;
  if (index < ranges.length - 1) {
    from = block.from;
    to = ranges[index + 1].from;
  } else if (index > 0) {
    from = ranges[index - 1].to;
    to = block.to;
  } else {
    from = block.from;
    to = block.to;
  }

  return [{ from, to, insert: "" }];
}
