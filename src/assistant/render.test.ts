import { describe, it, expect } from "vitest";
import { type ChatState, emptyChat, reduceEvents, isChatStreaming } from "./render";

function run(events: Parameters<typeof reduceEvents>[1][]): ChatState {
  return events.reduce(reduceEvents, emptyChat());
}

describe("reduceEvents", () => {
  it("starts empty", () => {
    expect(emptyChat().messages).toEqual([]);
  });

  it("appends a user message when the user sends", () => {
    const state = run([{ type: "user", text: "你好" }]);
    expect(state.messages).toEqual([{ role: "user", text: "你好" }]);
  });

  it("shows an assistant pending bubble immediately after submit", () => {
    const state = run([
      { type: "user", text: "你好" },
      { type: "pending" },
    ]);
    expect(state.messages).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "正在思考…", streaming: true, pending: true },
    ]);
  });

  it("replaces the pending bubble when the first assistant delta arrives", () => {
    const state = run([
      { type: "user", text: "你好" },
      { type: "pending" },
      { type: "delta", requestId: "r1", text: "Hel" },
    ]);
    expect(state.messages).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "Hel", streaming: true },
    ]);
  });

  it("removes the pending bubble before surfacing an error", () => {
    const state = run([
      { type: "user", text: "你好" },
      { type: "pending" },
      { type: "error", requestId: "r1", message: "agent not configured" },
    ]);
    expect(state.messages).toEqual([
      { role: "user", text: "你好" },
      { role: "error", text: "agent not configured" },
    ]);
  });

  it("surfaces an empty response when done arrives before any text", () => {
    const state = run([
      { type: "user", text: "你好" },
      { type: "pending" },
      { type: "done", requestId: "r1" },
    ]);
    expect(state.messages).toEqual([
      { role: "user", text: "你好" },
      { role: "error", text: "助手这次没有返回内容。请检查模型名称、API Key、服务商额度或网络连接后重试。" },
    ]);
  });

  it("opens a streaming assistant bubble on the first delta", () => {
    const state = run([{ type: "delta", requestId: "r1", text: "Hel" }]);
    expect(state.messages).toEqual([{ role: "assistant", text: "Hel", streaming: true }]);
  });

  it("accumulates consecutive deltas into the same bubble", () => {
    const state = run([
      { type: "delta", requestId: "r1", text: "Hel" },
      { type: "delta", requestId: "r1", text: "lo" },
    ]);
    expect(state.messages).toEqual([{ role: "assistant", text: "Hello", streaming: true }]);
  });

  it("finalizes the streaming bubble on done", () => {
    const state = run([
      { type: "delta", requestId: "r1", text: "Hello" },
      { type: "done", requestId: "r1" },
    ]);
    expect(state.messages).toEqual([{ role: "assistant", text: "Hello", streaming: false }]);
  });

  it("starts a fresh bubble for a new turn after done", () => {
    const state = run([
      { type: "delta", requestId: "r1", text: "one" },
      { type: "done", requestId: "r1" },
      { type: "delta", requestId: "r2", text: "two" },
    ]);
    expect(state.messages).toEqual([
      { role: "assistant", text: "one", streaming: false },
      { role: "assistant", text: "two", streaming: true },
    ]);
  });

  it("shows a tool placeholder on tool start and removes it on tool end", () => {
    const started = run([{ type: "tool", requestId: "r1", name: "write_note", phase: "start" }]);
    expect(started.messages).toEqual([{ role: "tool", label: "AI 正在整理笔记…" }]);

    const ended = reduceEvents(started, {
      type: "tool",
      requestId: "r1",
      name: "write_note",
      phase: "end",
    });
    expect(ended.messages).toEqual([]);
  });

  it("keeps the tool placeholder out of the way of a following assistant bubble", () => {
    const state = run([
      { type: "user", text: "整理一下" },
      { type: "tool", requestId: "r1", name: "write_note", phase: "start" },
      { type: "tool", requestId: "r1", name: "write_note", phase: "end" },
      { type: "delta", requestId: "r1", text: "已整理" },
      { type: "done", requestId: "r1" },
    ]);
    expect(state.messages).toEqual([
      { role: "user", text: "整理一下" },
      { role: "assistant", text: "已整理", streaming: false },
    ]);
  });

  it("interleaves a full exchange", () => {
    const state = run([
      { type: "user", text: "在哪些场景有效？" },
      { type: "delta", requestId: "r1", text: "在数学" },
      { type: "delta", requestId: "r1", text: "推导时" },
      { type: "done", requestId: "r1" },
    ]);
    expect(state.messages).toEqual([
      { role: "user", text: "在哪些场景有效？" },
      { role: "assistant", text: "在数学推导时", streaming: false },
    ]);
  });

  it("finalizes any open bubble and surfaces an error message", () => {
    const state = run([
      { type: "delta", requestId: "r1", text: "half" },
      { type: "error", requestId: "r1", message: "助手已断开" },
    ]);
    expect(state.messages).toEqual([
      { role: "assistant", text: "half", streaming: false },
      { role: "error", text: "助手已断开" },
    ]);
  });

  it("ignores ready events", () => {
    const state = run([{ type: "ready" }]);
    expect(state.messages).toEqual([]);
  });

  it("loads a session snapshot and marks it as active", () => {
    const state = run([
      {
        type: "session_opened",
        conversationId: "c1",
        sessionFile: "/tmp/c1.jsonl",
        messages: [
          { role: "user", text: "之前的问题", timestamp: 1 },
          { role: "assistant", text: "之前的回答", timestamp: 2 },
        ],
      },
    ]);

    expect(state.activeConversationId).toBe("c1");
    expect(state.messages).toEqual([
      { role: "user", text: "之前的问题" },
      { role: "assistant", text: "之前的回答", streaming: false },
    ]);
  });

  it("ignores stream events for a non-active conversation", () => {
    const state = run([
      {
        type: "session_opened",
        conversationId: "visible",
        sessionFile: "/tmp/visible.jsonl",
        messages: [],
      },
      { type: "delta", requestId: "r1", conversationId: "hidden", text: "wrong" },
    ]);

    expect(state.messages).toEqual([]);
  });

  it("replaces pending only when the delta belongs to the active conversation", () => {
    const state = run([
      {
        type: "session_opened",
        conversationId: "c1",
        sessionFile: "/tmp/c1.jsonl",
        messages: [],
      },
      { type: "user", conversationId: "c1", text: "你好" },
      { type: "pending", conversationId: "c1" },
      { type: "delta", requestId: "r-other", conversationId: "other", text: "wrong" },
      { type: "delta", requestId: "r1", conversationId: "c1", text: "right" },
    ]);

    expect(state.messages).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "right", streaming: true },
    ]);
  });

  it("keeps optimistic messages when a same-session empty snapshot arrives late", () => {
    const state = run([
      {
        type: "session_opened",
        conversationId: "c1",
        sessionFile: "/tmp/c1.jsonl",
        messages: [],
      },
      { type: "user", conversationId: "c1", text: "新问题" },
      { type: "pending", conversationId: "c1" },
      {
        type: "session_opened",
        conversationId: "c1",
        sessionFile: "/tmp/c1.jsonl",
        messages: [],
      },
    ]);

    expect(state.messages).toEqual([
      { role: "user", text: "新问题" },
      { role: "assistant", text: "正在思考…", streaming: true, pending: true },
    ]);
  });

  it("preserves the active conversation id while replacing a pending bubble", () => {
    const state = run([
      {
        type: "session_opened",
        conversationId: "c1",
        sessionFile: "/tmp/c1.jsonl",
        messages: [],
      },
      { type: "user", conversationId: "c1", text: "你好" },
      { type: "pending", conversationId: "c1" },
      { type: "delta", requestId: "r1", conversationId: "c1", text: "回答" },
    ]);

    expect(state.activeConversationId).toBe("c1");
    expect(reduceEvents(state, {
      type: "delta",
      requestId: "r-other",
      conversationId: "other",
      text: "wrong",
    }).messages).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", text: "回答", streaming: true },
    ]);
  });
});

describe("isChatStreaming", () => {
  it("空状态不流式", () => {
    expect(isChatStreaming(emptyChat())).toBe(false);
  });
  it("pending 事件后处于流式", () => {
    let s = reduceEvents(emptyChat(), { type: "user", text: "hi" });
    s = reduceEvents(s, { type: "pending" });
    expect(isChatStreaming(s)).toBe(true);
  });
  it("done 事件后停止流式", () => {
    let s = reduceEvents(emptyChat(), { type: "user", text: "hi" });
    s = reduceEvents(s, { type: "pending" });
    s = reduceEvents(s, { type: "delta", requestId: "r1", text: "x" });
    s = reduceEvents(s, { type: "done", requestId: "r1" });
    expect(isChatStreaming(s)).toBe(false);
  });
});
