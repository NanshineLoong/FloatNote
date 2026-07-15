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
