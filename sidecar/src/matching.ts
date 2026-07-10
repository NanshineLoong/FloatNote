import { blockRanges, stripTagMarker, type BlockRange } from "@floatnote/note-logic";

export type ReplaceResult =
  | { ok: true; newContent: string }
  | { ok: false; error: string };

/** Replace the single unique occurrence of `oldString` in `doc`. */
export function replaceOnce(doc: string, oldString: string, newString: string): ReplaceResult {
  if (oldString.length === 0) return { ok: false, error: "old_string 不能为空" };
  const idx = doc.indexOf(oldString);
  if (idx === -1) return { ok: false, error: "未找到要替换的文本" };
  if (doc.indexOf(oldString, idx + 1) !== -1) {
    return { ok: false, error: "要替换的文本不唯一，请补充更多上下文" };
  }
  const newContent = doc.slice(0, idx) + newString + doc.slice(idx + oldString.length);
  return { ok: true, newContent };
}

export type AnchorResult =
  | { ok: true; range: BlockRange }
  | { ok: false; error: string };

/** Find the unique block whose normalized text starts with `anchor`. */
export function findBlockByAnchor(doc: string, anchor: string): AnchorResult {
  if (anchor.length === 0) return { ok: false, error: "anchor 不能为空" };
  const matches = blockRanges(doc).filter((range) => {
    const text = stripTagMarker(doc.slice(range.from, range.to));
    return text.startsWith(anchor);
  });
  if (matches.length === 0) return { ok: false, error: "未找到匹配的块" };
  if (matches.length > 1) return { ok: false, error: "anchor 匹配到多个块，请补充上下文" };
  return { ok: true, range: matches[0] };
}
