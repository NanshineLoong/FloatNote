import { describe, expect, it } from "vitest";
import {
  deriveTitleFromFirstMessage,
  formatHistoryTime,
} from "./chat-history-format";

describe("chat history display formatting", () => {
  it("uses short first messages as final conversation titles", () => {
    expect(deriveTitleFromFirstMessage("整理一下")).toEqual({
      title: "整理一下",
      titleState: "final",
    });
  });

  it("uses the first ten characters of a long first message as a temporary title", () => {
    expect(deriveTitleFromFirstMessage("请帮我把今天会议纪要整理成行动项")).toEqual({
      title: "请帮我把今天会议纪要",
      titleState: "temporary",
    });
  });

  it("formats history times by recency", () => {
    const now = new Date("2026-07-08T15:40:00+08:00").getTime();

    expect(formatHistoryTime(new Date("2026-07-08T09:05:00+08:00").getTime(), now)).toBe("09:05");
    expect(formatHistoryTime(new Date("2026-07-07T22:00:00+08:00").getTime(), now)).toBe("昨天");
    expect(formatHistoryTime(new Date("2026-07-05T12:00:00+08:00").getTime(), now)).toBe("07/05");
    expect(formatHistoryTime(new Date("2025-12-31T12:00:00+08:00").getTime(), now)).toBe("2025/12/31");
  });
});
