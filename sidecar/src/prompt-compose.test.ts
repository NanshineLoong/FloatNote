// @vitest-environment node
import { describe, it, expect } from "vitest";
import { composePromptText } from "./prompt-compose";
import type { PromptRef } from "./protocol";

const FILE: PromptRef = { kind: "file", id: "p/piece.md", display: "piece.md", noteKind: "piece" };
const SKILL: PromptRef = { kind: "skill", id: "summarize", display: "summarize" };

describe("composePromptText", () => {
  it("无引用无 skill → 原样返回 userText（向后兼容）", () => {
    expect(composePromptText({ userText: "你好" })).toBe("你好");
  });

  it("保留 /skill:name 文本前缀的 verbatim 透传", () => {
    expect(composePromptText({ userText: "/skill:socratic-review 帮我审一下这篇" })).toBe(
      "/skill:socratic-review 帮我审一下这篇",
    );
  });

  it("references 非空 → 正文后追加 [引用] 块", () => {
    const out = composePromptText({ userText: "看看", references: [FILE] });
    expect(out).toBe("看看\n\n[引用]\n- file: piece.md [p/piece.md] (piece)");
  });

  it("skill 字段 → 以 /skill:<name> 前缀开头", () => {
    const out = composePromptText({ userText: "总结", skill: { name: "summarize" } });
    expect(out.startsWith("/skill:summarize ")).toBe(true);
    expect(out).toBe("/skill:summarize 总结");
  });

  it("skill + references 同时存在 → 前缀 + 正文 + 引用块", () => {
    const out = composePromptText({
      userText: "总结",
      references: [FILE, SKILL],
      skill: { name: "summarize" },
    });
    expect(out).toBe(
      "/skill:summarize 总结\n\n[引用]\n- file: piece.md [p/piece.md] (piece)\n- skill: summarize [summarize]",
    );
  });

  it("无 noteKind 的引用不输出括号", () => {
    const out = composePromptText({ userText: "", references: [SKILL] });
    expect(out).toBe("\n\n[引用]\n- skill: summarize [summarize]");
  });
});
