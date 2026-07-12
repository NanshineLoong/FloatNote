/**
 * 引用片段文档模型（纯逻辑，无 CM6 依赖）。
 *
 * 把「普通文本 + 文件/Skill 引用」统一表示为 `Segment[]`。每个引用在文档文本里编码为
 * 一个 token：起止哨兵 `…` 包裹 JSON.stringify(Ref)。这样：
 *  - 引用数据本身在文档里 → 撤销/重做/复制/跨模式迁移随文本天然保留，不依赖任何
 *    side-table 或 effect（CM6 redo 不重放 effect，side-table 方案在 redo 丢引用）；
 *  - 显示名(display) 与内部标识(id) 分离：token 存全量 Ref，解析只认 id；
 *  - token 被原子 widget 视觉替换成 chip，用户看不到 JSON。
 *
 * 哨兵用私用区 U+F101/U+F102，不会出现在用户正文里；JSON 已转义任意分隔符。
 */

/** 文件引用的笔记种类（与 mention-picker 的 MentionKind 对齐）。 */
export type NoteKind = "inbox" | "tasks" | "piece" | "doc";

export interface Ref {
  /** 引用种类：文件或 Skill。 */
  kind: "file" | "skill";
  /** 稳定内部标识：文件用作用域内路径/文件名，skill 用 skill name。永不依赖 display。 */
  id: string;
  /** chip 上给用户看的名字；可随重命名变化，不参与解析。 */
  display: string;
  /** 仅文件引用携带的笔记种类徽标。 */
  meta?: { noteKind?: NoteKind };
}

export type Segment =
  | { type: "text"; text: string }
  | { type: "ref"; ref: Ref };

export const REF_CLIPBOARD_MIME = "text/x-floatnote-refs";

/** 引用 token 的起止哨兵（私用区，永不进入用户正文）。 */
export const REF_OPEN = "\uF101";
export const REF_CLOSE = "\uF102";
const TOKEN = new RegExp(
  `${escapeForRegex(REF_OPEN)}([\\s\\S]*?)${escapeForRegex(REF_CLOSE)}`,
  "g",
);

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 把一段文本解析为 Segment[]：文本与引用 token 交织。 */
export function parseDoc(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: "text", text: text.slice(last, m.index) });
    const ref = tryParseRef(m[1]);
    if (ref) segments.push({ type: "ref", ref });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: "text", text: text.slice(last) });
  return segments;
}

function tryParseRef(json: string): Ref | null {
  try {
    const r = JSON.parse(json) as Ref;
    if (r && (r.kind === "file" || r.kind === "skill") && typeof r.id === "string") {
      return r;
    }
    return null;
  } catch {
    return null;
  }
}

/** 把 Segment[] 序列化回文档文本（round-trip parseDoc 的逆）。 */
export function serializeDoc(segments: Segment[]): string {
  let text = "";
  for (const seg of segments) {
    if (seg.type === "text") {
      text += seg.text;
    } else {
      text += REF_OPEN + JSON.stringify(seg.ref) + REF_CLOSE;
    }
  }
  return text;
}

/** 编码单个 Ref 为 token（供插入事务用）。 */
export function refToken(ref: Ref): string {
  return REF_OPEN + JSON.stringify(ref) + REF_CLOSE;
}

/** 从文档文本提取有序引用列表（供提交 payload）。 */
export function refsInDoc(text: string): Ref[] {
  return parseDoc(text)
    .filter((s): s is { type: "ref"; ref: Ref } => s.type === "ref")
    .map((s) => s.ref);
}

/** 提取可见正文（不含引用），常用于占位/计数。 */
export function visibleText(segments: Segment[]): string {
  return segments
    .filter((s): s is { type: "text"; text: string } => s.type === "text")
    .map((s) => s.text)
    .join("");
}

/** 文档里是否含引用 token。 */
export function hasRef(text: string): boolean {
  return text.indexOf(REF_OPEN) !== -1 && text.indexOf(REF_CLOSE) !== -1;
}

/** 内部剪贴板同时提供可供其他应用阅读的纯文本，以及可恢复 chip 的片段。 */
export function clipboardPayload(text: string): { plainText: string; structured: Segment[] } {
  const structured = parseDoc(text);
  return { plainText: visibleText(structured), structured };
}

/** 从自定义 MIME 恢复片段；无效或外部剪贴板退化为普通文本。 */
export function docFromClipboard(plainText: string, structured: string): string {
  try {
    const parsed = JSON.parse(structured) as unknown;
    if (Array.isArray(parsed) && parsed.every(isSegment)) return serializeDoc(parsed);
  } catch {
    // External clipboard content has no FloatNote MIME, which is expected.
  }
  return plainText;
}

function isSegment(value: unknown): value is Segment {
  if (!value || typeof value !== "object") return false;
  const segment = value as { type?: unknown; text?: unknown; ref?: unknown };
  if (segment.type === "text") return typeof segment.text === "string";
  if (segment.type !== "ref" || !segment.ref || typeof segment.ref !== "object") return false;
  const ref = segment.ref as { kind?: unknown; id?: unknown; display?: unknown; meta?: unknown };
  if ((ref.kind !== "file" && ref.kind !== "skill") || typeof ref.id !== "string" || typeof ref.display !== "string") {
    return false;
  }
  if (ref.meta === undefined) return true;
  if (!ref.meta || typeof ref.meta !== "object") return false;
  const noteKind = (ref.meta as { noteKind?: unknown }).noteKind;
  return noteKind === undefined || noteKind === "inbox" || noteKind === "tasks" || noteKind === "piece" || noteKind === "doc";
}

/** 定位包含 pos 的引用 token 区间（供 chip X 按钮按位置删整个 token）。无则 null。 */
export function findRefTokenRange(text: string, pos: number): { from: number; to: number } | null {
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;
    if (pos >= from && pos <= to) return { from, to };
    if (m.index === text.length) break;
  }
  return null;
}
