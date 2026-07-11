/**
 * 提交 payload 组装（纯函数）。
 *
 * 把文档文本（含引用 token）拆成：可见正文 userText + 结构化 references + skill。
 * chip 不以文本出现在 userText；显示名(display) 与内部标识(id) 分离：payload 只
 * 认 id。skill 取首个 skill 引用（同一条消息只绑定一个 skill）。
 *
 * wire 上的 PromptRef 把 model 的 meta.noteKind 摊平为顶层 noteKind，便于 Rust serde。
 */
import { parseDoc, type Ref } from "./model";

export interface PromptRef {
  kind: "file" | "skill";
  id: string;
  display: string;
  noteKind?: "inbox" | "tasks" | "piece" | "doc";
}

export interface PromptPayload {
  /** 可见正文，不含引用 token。 */
  userText: string;
  /** 全部引用（文件 + skill），按文档顺序。 */
  references: PromptRef[];
  /** 首个 skill 引用的稳定 name；无 skill 时缺省。 */
  skill?: { name: string };
}

function toWire(ref: Ref): PromptRef {
  const out: PromptRef = { kind: ref.kind, id: ref.id, display: ref.display };
  if (ref.meta?.noteKind) out.noteKind = ref.meta.noteKind;
  return out;
}

/** 从文档文本组装提交 payload。 */
export function composePromptPayload(docText: string): PromptPayload {
  const segs = parseDoc(docText);
  const userText = segs
    .filter((s): s is { type: "text"; text: string } => s.type === "text")
    .map((s) => s.text)
    .join("");
  const references = segs
    .filter((s): s is { type: "ref"; ref: Ref } => s.type === "ref")
    .map((s) => toWire(s.ref));
  const firstSkill = segs.find(
    (s): s is { type: "ref"; ref: Ref } => s.type === "ref" && s.ref.kind === "skill",
  );
  const payload: PromptPayload = { userText, references };
  if (firstSkill) payload.skill = { name: firstSkill.ref.id };
  return payload;
}
