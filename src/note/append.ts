/**
 * Compute the text to insert at the end of `doc` so that `block` is separated
 * from existing content by exactly one blank line.
 */
export function buildAppendInsert(doc: string, block: string): string {
  if (doc.trim() === "") return block;
  const trailingNewlines = doc.length - doc.replace(/\n+$/, "").length;
  const needed = Math.max(0, 2 - trailingNewlines);
  return "\n".repeat(needed) + block;
}

