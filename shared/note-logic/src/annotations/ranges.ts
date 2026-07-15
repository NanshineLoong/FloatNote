import type { TextAnnotation, TextChange, TextRange } from "./types";

function validRanges(ranges: TextRange[]): TextRange[] {
  return ranges
    .filter((range) => range.from < range.to)
    .sort((a, b) => a.from - b.from || a.to - b.to);
}

function canonicalRanges(ranges: TextRange[]): TextRange[] {
  const result: TextRange[] = [];
  for (const range of validRanges(ranges)) {
    const last = result[result.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else result.push({ ...range });
  }
  return result;
}

export function addAnnotationRanges(
  annotations: TextAnnotation[],
  tagId: string,
  ranges: TextRange[],
  createId: () => string,
): TextAnnotation[] {
  const existing = annotations.filter((annotation) => annotation.tagId === tagId);
  const other = annotations.filter((annotation) => annotation.tagId !== tagId);
  const merged = canonicalRanges([...existing, ...ranges]);
  const next = merged.map((range) => {
    const retained = existing.find((annotation) => (
      annotation.from <= range.to && annotation.to >= range.from
    ));
    return { id: retained?.id ?? createId(), tagId, ...range };
  });
  return [...next, ...other].sort((a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id));
}

export function removeAnnotationRanges(
  annotations: TextAnnotation[],
  tagId: string,
  ranges: TextRange[],
  createId: () => string,
): TextAnnotation[] {
  const removals = canonicalRanges(ranges);
  const result: TextAnnotation[] = [];
  for (const annotation of annotations) {
    if (annotation.tagId !== tagId) {
      result.push(annotation);
      continue;
    }
    let pieces: TextRange[] = [{ from: annotation.from, to: annotation.to }];
    for (const removal of removals) {
      pieces = pieces.flatMap((piece) => {
        if (removal.to <= piece.from || removal.from >= piece.to) return [piece];
        const next: TextRange[] = [];
        if (piece.from < removal.from) next.push({ from: piece.from, to: removal.from });
        if (removal.to < piece.to) next.push({ from: removal.to, to: piece.to });
        return next;
      });
    }
    pieces.forEach((piece, index) => result.push({
      id: index === 0 ? annotation.id : createId(),
      tagId,
      ...piece,
    }));
  }
  return result.sort((a, b) => a.from - b.from || a.to - b.to || a.id.localeCompare(b.id));
}

function mapPosition(pos: number, changes: TextChange[], assoc: -1 | 1): number {
  let delta = 0;
  for (const change of [...changes].sort((a, b) => a.from - b.from || a.to - b.to)) {
    const inserted = change.insert.length;
    const removed = change.to - change.from;
    if (pos < change.from || (pos === change.from && removed > 0 && assoc < 0)) break;
    if (pos > change.to || (pos === change.to && removed > 0 && assoc > 0)) {
      delta += inserted - removed;
      continue;
    }
    if (removed === 0 && pos === change.from) {
      return pos + delta + (assoc > 0 ? inserted : 0);
    }
    return change.from + delta + (assoc > 0 ? inserted : 0);
  }
  return pos + delta;
}

export function mapAnnotations(
  annotations: TextAnnotation[],
  changes: TextChange[],
): TextAnnotation[] {
  return annotations.flatMap((annotation) => {
    const from = mapPosition(annotation.from, changes, 1);
    const to = mapPosition(annotation.to, changes, -1);
    return from < to ? [{ ...annotation, from, to }] : [];
  });
}

export function mapPoint(pos: number, changes: TextChange[], assoc: -1 | 1 = 1): number {
  return mapPosition(pos, changes, assoc);
}
