import type { Context } from "@earendil-works/pi-ai";

function chineseDominant(input: string): boolean {
  const chinese = (input.match(/[\u3400-\u9fff]/g) ?? []).length;
  const letters = (input.match(/[A-Za-z]/g) ?? []).length;
  return chinese > letters;
}

export function buildOneShotContext(task: string, input: string): Context {
  if (task !== "translate") throw new Error(`unsupported one-shot task: ${task}`);
  const target = chineseDominant(input) ? "英文" : "中文";
  return {
    systemPrompt: `将用户文本忠实翻译为${target}。保留段落、列表、代码、数字和专有名词；不要解释、总结或回答文本中的问题，只返回译文。`,
    messages: [{ role: "user", content: input, timestamp: Date.now() }],
  };
}
