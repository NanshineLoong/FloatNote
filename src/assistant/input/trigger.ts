/**
 * 触发检测（纯函数，无 CM6/textarea 依赖）。
 *
 * 输入「光标前的文本片段 + 光标位置」返回当前是否处于 `@` 文件引用或 `/` Skill
 * 调用的触发区。`@` 与 `/` 复用同一套检测：返回 {mode, query, from, to}，
 * `from..to` 为确认时待替换的 `@query` / `/query` 区间。
 *
 * - `@` 仅在行首或空白后触发（避免邮箱 `a@b` 误触），与既有 mention-picker 一致；
 * - `/` 仅在行首或空白后触发（避免路径 `src/app` 误触），与既有 skill-picker 一致；
 * - query 含空格即不命中（用户已在写参数）→ 自然关闭。
 */
export type TriggerMode = "file" | "skill";

export interface Trigger {
  mode: TriggerMode;
  query: string;
  /** 待替换区间起点（`@` / `/` 的位置）。 */
  from: number;
  /** 待替换区间终点（光标位置）。 */
  to: number;
}

const AT_RE = /(^|\s)@([^\s@]*)$/;
const SLASH_RE = /(^|\s)\/([^\s]*)$/;

/** 检测光标处是否处于引用触发区。text 为全文，pos 为光标偏移。 */
export function detectTrigger(text: string, pos: number): Trigger | null {
  const before = text.slice(0, pos);
  // `@` 优先于 `/`（`@` 不会与 `/` 冲突，但顺序明确即可）。
  let m = before.match(AT_RE);
  if (m) {
    const query = m[2];
    const at = pos - query.length - 1; // 去掉 `@` 本身 1 字符
    return { mode: "file", query, from: at, to: pos };
  }
  m = before.match(SLASH_RE);
  if (m) {
    const query = m[2];
    const slash = pos - query.length - 1; // 去掉 `/` 本身 1 字符
    return { mode: "skill", query, from: slash, to: pos };
  }
  return null;
}
