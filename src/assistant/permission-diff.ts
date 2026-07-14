import { diffLines } from "diff";

export type DiffRow =
  | { kind: "unchanged" | "added" | "removed" | "replaced"; oldText: string; newText: string }
  | { kind: "collapsed"; rows: Array<Extract<DiffRow, { oldText: string }>> };

type ContentRow = Extract<DiffRow, { oldText: string }>;

function lines(value: string): string[] {
  if (!value) return [];
  const result = value.split("\n");
  if (result.at(-1) === "") result.pop();
  return result.map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
}

export function buildDiffRows(oldContent: string, newContent: string): ContentRow[] {
  const changes = diffLines(oldContent, newContent);
  const rows: ContentRow[] = [];
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    if (!change.added && !change.removed) {
      for (const line of lines(change.value)) rows.push({ kind: "unchanged", oldText: line, newText: line });
      continue;
    }
    if (change.removed && changes[index + 1]?.added) {
      const removed = lines(change.value);
      const added = lines(changes[index + 1].value);
      const length = Math.max(removed.length, added.length);
      for (let row = 0; row < length; row += 1) {
        if (row < removed.length && row < added.length) rows.push({ kind: "replaced", oldText: removed[row], newText: added[row] });
        else if (row < removed.length) rows.push({ kind: "removed", oldText: removed[row], newText: "" });
        else rows.push({ kind: "added", oldText: "", newText: added[row] });
      }
      index += 1;
      continue;
    }
    for (const line of lines(change.value)) {
      rows.push(change.added
        ? { kind: "added", oldText: "", newText: line }
        : { kind: "removed", oldText: line, newText: "" });
    }
  }
  return rows;
}

export function foldDiffRows(rows: ContentRow[], context = 3): DiffRow[] {
  const result: DiffRow[] = [];
  let index = 0;
  while (index < rows.length) {
    if (rows[index].kind !== "unchanged") {
      result.push(rows[index++]);
      continue;
    }
    let end = index;
    while (end < rows.length && rows[end].kind === "unchanged") end += 1;
    const run = rows.slice(index, end);
    const keepStart = index === 0 ? 0 : Math.min(context, run.length);
    const keepEnd = end === rows.length ? 0 : Math.min(context, run.length - keepStart);
    if (run.length - keepStart - keepEnd > 0 && run.length > context) {
      result.push(...run.slice(0, keepStart));
      result.push({ kind: "collapsed", rows: run.slice(keepStart, run.length - keepEnd) });
      result.push(...run.slice(run.length - keepEnd));
    } else result.push(...run);
    index = end;
  }
  return result;
}
