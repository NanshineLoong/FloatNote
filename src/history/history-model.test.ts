import { describe, expect, it } from "vitest";
import {
  fallbackConversationTitle,
  filterAndGroupHistory,
  normalizeGeneratedTitle,
  scopeFilterKey,
} from "./history-model";
import type { ChatConversation } from "../platform/chat-history";

const now = new Date("2026-07-11T15:40:00+08:00").getTime();

function conversation(overrides: Partial<ChatConversation>): ChatConversation {
  return {
    id: "c1",
    sessionFile: "/sessions/c1.jsonl",
    scopeType: "project",
    scopePath: "/projects/floatnote",
    scopeLabel: "FloatNote",
    title: "新对话",
    titleState: "temporary",
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    ...overrides,
  };
}

describe("filterAndGroupHistory", () => {
  it("filters by the selected project while preserving local-date groups", () => {
    const result = filterAndGroupHistory([
      conversation({ id: "today", updatedAt: new Date("2026-07-11T09:00:00+08:00").getTime() }),
      conversation({
        id: "yesterday",
        updatedAt: new Date("2026-07-10T21:00:00+08:00").getTime(),
      }),
      conversation({
        id: "other-project",
        scopePath: "/projects/other",
        scopeLabel: "Other",
        updatedAt: new Date("2026-07-11T11:00:00+08:00").getTime(),
      }),
    ], scopeFilterKey("project", "/projects/floatnote"), now);

    expect(result.map((group) => [group.label, group.conversations.map((item) => item.id)])).toEqual([
      ["今天", ["today"]],
      ["昨天", ["yesterday"]],
    ]);
  });

  it("sorts entries within a date group by most recently updated", () => {
    const result = filterAndGroupHistory([
      conversation({ id: "older", updatedAt: new Date("2026-07-11T08:00:00+08:00").getTime() }),
      conversation({ id: "newer", updatedAt: new Date("2026-07-11T12:00:00+08:00").getTime() }),
    ], "all", now);

    expect(result).toHaveLength(1);
    expect(result[0].conversations.map((item) => item.id)).toEqual(["newer", "older"]);
  });
});

describe("conversation title rules", () => {
  it("normalizes an AI title to one concise plain-text line", () => {
    expect(normalizeGeneratedTitle("  **梳理发布流程**\n并安排后续  ")).toBe("梳理发布流程并安排后续");
  });

  it("uses a stable first-message fallback when generation fails", () => {
    expect(fallbackConversationTitle("请帮我把今天的会议纪要整理成行动项", "新对话")).toBe("请帮我把今天的会议纪");
    expect(fallbackConversationTitle("   ", "新对话")).toBe("新对话");
  });
});
