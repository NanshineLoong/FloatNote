/** Recent-projects MRU list helpers. The list holds project folder paths,
 * most-recent first, capped at {@link RECENT_LIMIT}. It is the sole source for
 * the project switcher menu — projects may live anywhere on disk. */

export const RECENT_LIMIT = 8;

/** Move `path` to the front of the MRU list, dedupe, and cap to `limit`.
 * Returns a new array; the input is not mutated. */
export function pushRecent(list: string[], path: string, limit = RECENT_LIMIT): string[] {
  const next = [path, ...list.filter((entry) => entry !== path)];
  return next.slice(0, limit);
}

/** Parent directory of a project folder path, separator-correct for both
 * POSIX (`/`) and Windows (`\\`). Used to create a sibling project. */
export function parentDir(projectPath: string): string {
  const trimmed = projectPath.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx <= 0 ? trimmed : trimmed.slice(0, idx);
}
