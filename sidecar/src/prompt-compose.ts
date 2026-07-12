/**
 * 把 prompt 请求（userText + 结构化 references + skill）序列化成给 Pi session.prompt
 * 的纯文本。纯函数，可单测。
 *
 * - 无 references 且无 skill 时 → 原样返回 userText（向后兼容旧前端、verbatim 透传）；
 * - skill 存在 → 以 `/skill:<name> ` 前缀开头（Pi session.prompt 原生展开）；
 * - references 非空 → 在正文后追加 `[引用]` 块，列出 display + 稳定 id；sidecar 已有
 *   工作目录访问，文件引用按路径给出，LM/工具可自行解析。
 */
import type { PromptRef } from "./protocol.js";

export interface PromptComposeInput {
  userText: string;
  references?: PromptRef[];
  skill?: { name: string };
}

/** 组装给 Pi 的最终 prompt 文本。 */
export function composePromptText(input: PromptComposeInput): string {
  const { userText, references, skill } = input;
  let body = userText;
  if (references && references.length > 0) {
    body += "\n\n" + referencesBlock(references);
  }
  if (skill && skill.name) {
    return `/skill:${skill.name} ${body}`;
  }
  return body;
}

function referencesBlock(refs: PromptRef[]): string {
  const lines = refs.map((r) => {
    const kind = r.kind === "file" ? "file" : "skill";
    const noteKind = r.noteKind ? ` (${r.noteKind})` : "";
    return `- ${kind}: ${r.display} [${r.id}]${noteKind}`;
  });
  return "[引用]\n" + lines.join("\n");
}
