import { describe, expect, it } from "vitest";
import { buildOneShotContext } from "./one-shot.js";

describe("one-shot translation", () => {
  it("translates Chinese-dominant input to English without tools or session context", () => {
    const context = buildOneShotContext("translate", "这是以中文为主的内容 with");
    expect(context.systemPrompt).toContain("翻译为英文");
    expect(context.systemPrompt).toContain("不要解释");
    expect(context.messages).toHaveLength(1);
    expect(context.messages[0]).toMatchObject({ role: "user", content: "这是以中文为主的内容 with" });
  });

  it("translates other input to Chinese", () => {
    expect(buildOneShotContext("translate", "The medium is the message.").systemPrompt).toContain("翻译为中文");
  });

  it("rejects unknown tasks", () => {
    expect(() => buildOneShotContext("summarize", "hello")).toThrow("unsupported one-shot task");
  });
});
