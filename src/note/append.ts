/**
 * Compute the text to insert at the caret so that `block` forms its own
 * paragraph, separated from surrounding content by exactly one blank line on
 * each side.
 *
 * `before` is the document text up to the caret, `after` is the text from the
 * caret onward. Blank-line padding is only added where there is adjacent
 * content, so inserting at the very top or bottom of the document adds no
 * stray newlines on the empty side.
 */
export function buildCaretInsert(before: string, after: string, block: string): string {
  const lead = before.trim() === "" ? 0 : Math.max(0, 2 - countTrailingNewlines(before));
  const trail = after.trim() === "" ? 0 : Math.max(0, 2 - countLeadingNewlines(after));
  return "\n".repeat(lead) + block + "\n".repeat(trail);
}

function countTrailingNewlines(text: string): number {
  return text.length - text.replace(/\n+$/, "").length;
}

function countLeadingNewlines(text: string): number {
  return text.length - text.replace(/^\n+/, "").length;
}
