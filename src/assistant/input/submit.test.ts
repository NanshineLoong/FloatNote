// @vitest-environment node
import { describe, it, expect } from "vitest";
import { composePromptPayload } from "./submit";
import { refToken, REF_OPEN, REF_CLOSE } from "./model";
import type { Ref } from "./model";

const FILE: Ref = { kind: "file", id: "p/piece.md", display: "piece.md", meta: { noteKind: "piece" } };
const SKILL: Ref = { kind: "skill", id: "summarize", display: "summarize" };

describe("composePromptPayload", () => {
  it("纯文本：userText=全文，无引用", () => {
    expect(composePromptPayload("你好")).toEqual({ userText: "你好", references: [] });
  });

  it("chip 不进 userText；references 含结构化引用", () => {
    const doc = `看看${refToken(FILE)}帮我`;
    const p = composePromptPayload(doc);
    expect(p.userText).toBe("看看帮我");
    expect(p.references).toEqual([
      { kind: "file", id: "p/piece.md", display: "piece.md", noteKind: "piece" },
    ]);
    expect(p.skill).toBeUndefined();
  });

  it("skill 引用提取为 skill.name（用稳定 id）", () => {
    const doc = `${refToken(SKILL)}总结`;
    const p = composePromptPayload(doc);
    expect(p.userText).toBe("总结");
    expect(p.skill).toEqual({ name: "summarize" });
    // references 也含该 skill 引用
    expect(p.references[0]).toEqual({ kind: "skill", id: "summarize", display: "summarize" });
  });

  it("display 与 id 分离：display 变化不影响 id", () => {
    const renamed: Ref = { ...FILE, display: "旧名.md" };
    const p = composePromptPayload(refToken(renamed));
    expect(p.references[0].id).toBe("p/piece.md");
    expect(p.references[0].display).toBe("旧名.md");
  });

  it("无 noteKind 的引用不携带 noteKind 字段", () => {
    const p = composePromptPayload(refToken(SKILL));
    expect("noteKind" in p.references[0]).toBe(false);
  });

  it("损坏 token 不进 userText/references", () => {
    const doc = `你好${REF_OPEN}not-json${REF_CLOSE}它`;
    const p = composePromptPayload(doc);
    expect(p.userText).toBe("你好它");
    expect(p.references).toEqual([]);
  });
});
