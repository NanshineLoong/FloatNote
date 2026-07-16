import { describe, expect, it } from "vitest";
import { TUTOR_SYSTEM_PROMPT } from "./tutor-prompt.js";

describe("TUTOR_SYSTEM_PROMPT", () => {
  it("uses the thinking-partner kernel and minimal workspace contract", () => {
    expect(TUTOR_SYSTEM_PROMPT).toContain("思考与笔记伙伴");
    expect(TUTOR_SYSTEM_PROMPT).toContain("<floatnote_workspace>");
    expect(TUTOR_SYSTEM_PROMPT).toContain("_inbox.md 是连续采集区");
    expect(TUTOR_SYSTEM_PROMPT).toContain("_tasks.md 是 Markdown checklist");
    expect(TUTOR_SYSTEM_PROMPT).not.toContain("AI 学习导师");
    expect(TUTOR_SYSTEM_PROMPT).not.toContain("read_note");
    expect(TUTOR_SYSTEM_PROMPT).not.toContain("每次回应都尽量");
  });

  it("does not duplicate the Skill catalog in the base prompt", () => {
    expect(TUTOR_SYSTEM_PROMPT).not.toContain("<available_skills>");
  });
});
