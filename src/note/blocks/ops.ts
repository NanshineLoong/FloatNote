import type { Block } from "./parse";

/** Move the block at `from` so it lands at insertion index `to`, where `to` is
 * an index into the ORIGINAL array (0..length). This matches the drop logic in
 * the view, which counts how many cards sit above the pointer. */
export function moveBlock(blocks: Block[], from: number, to: number): Block[] {
  if (from < 0 || from >= blocks.length) return blocks;
  const next = blocks.slice();
  const [moved] = next.splice(from, 1);
  const insert = to > from ? to - 1 : to;
  next.splice(Math.max(0, Math.min(insert, next.length)), 0, moved);
  return next;
}

export function removeBlock(blocks: Block[], index: number): Block[] {
  return blocks.filter((_, i) => i !== index);
}

export function toggleTodo(blocks: Block[], index: number): Block[] {
  const block = blocks[index];
  if (!block || block.kind !== "todo") return blocks;
  return blocks.map((b, i) => (i === index ? { ...block, checked: !block.checked } : b));
}
