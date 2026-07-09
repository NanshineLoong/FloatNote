import { describe, it, expect } from "vitest";
import { type ChatState, type ChatMessage, emptyChat, reduceEvents, isChatStreaming } from "./render";

function run(events: Parameters<typeof reduceEvents>[1][]): ChatState {
  return events.reduce(reduceEvents, emptyChat());
}

/** 归一化：去掉生成的 id（消息/块），便于值比较。 */
function norm(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", text: m.text };
    const { id: _m, ...rest } = m;
    return { ...rest, blocks: m.blocks.map((b) => {
      const { id: _b, ...rb } = b;
      return rb;
    }) };
  });
}

describe("reduceEvents", () => {
  it("starts empty", () => {
    expect(emptyChat().messages).toEqual([]);
  });

  it("appends a user message when the user sends", () => {
    const state = run([{ type: "user", text: "你好" }]);
    expect(norm(state.messages)).toEqual([{ role: "user", text: "你好" }]);
  });

  it("shows an assistant pending bubble immediately after submit", () => {
    const state = run([{ type: "user", text: "你好" }, { type: "pending" }]);
    expect(norm(state.messages)).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", streaming: true, pending: true, blocks: [{ kind: "text", text: "正在思考…", streaming: true }] },
    ]);
  });

  it("replaces the pending bubble when the first assistant delta arrives", () => {
    const state = run([
      { type: "user", text: "你好" },
      { type: "pending" },
      { type: "delta", requestId: "r1", text: "Hel" },
    ]);
    expect(norm(state.messages)).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", streaming: true, blocks: [{ kind: "text", text: "Hel", streaming: true }] },
    ]);
  });

  it("removes the pending bubble before surfacing an error", () => {
    const state = run([
      { type: "user", text: "你好" },
      { type: "pending" },
      { type: "error", requestId: "r1", message: "agent not configured" },
    ]);
    expect(norm(state.messages)).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", streaming: false, blocks: [{ kind: "error", text: "agent not configured" }] },
    ]);
  });

  it("surfaces an empty response when done arrives before any text", () => {
    const state = run([
      { type: "user", text: "你好" },
      { type: "pending" },
      { type: "done", requestId: "r1" },
    ]);
    expect(norm(state.messages)).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", streaming: false, blocks: [{ kind: "error", text: "助手这次没有返回内容。请检查模型名称、API Key、服务商额度或网络连接后重试。" }] },
    ]);
  });

  it("opens a streaming assistant bubble on the first delta", () => {
    const state = run([{ type: "delta", requestId: "r1", text: "Hel" }]);
    expect(norm(state.messages)).toEqual([
      { role: "assistant", streaming: true, blocks: [{ kind: "text", text: "Hel", streaming: true }] },
    ]);
  });

  it("accumulates consecutive deltas into the same text block", () => {
    const state = run([
      { type: "delta", requestId: "r1", text: "Hel" },
      { type: "delta", requestId: "r1", text: "lo" },
    ]);
    expect(norm(state.messages)).toEqual([
      { role: "assistant", streaming: true, blocks: [{ kind: "text", text: "Hello", streaming: true }] },
    ]);
  });

  it("finalizes the streaming bubble on done", () => {
    const state = run([
      { type: "delta", requestId: "r1", text: "Hello" },
      { type: "done", requestId: "r1" },
    ]);
    expect(norm(state.messages)).toEqual([
      { role: "assistant", streaming: false, blocks: [{ kind: "text", text: "Hello", streaming: false }] },
    ]);
  });

  it("starts a fresh bubble for a new turn after done", () => {
    const state = run([
      { type: "delta", requestId: "r1", text: "one" },
      { type: "done", requestId: "r1" },
      { type: "delta", requestId: "r2", text: "two" },
    ]);
    expect(norm(state.messages)).toEqual([
      { role: "assistant", streaming: false, blocks: [{ kind: "text", text: "one", streaming: false }] },
      { role: "assistant", streaming: true, blocks: [{ kind: "text", text: "two", streaming: true }] },
    ]);
  });

  it("creates an action block on tool start and marks it done on tool end", () => {
    const started = run([{ type: "tool", requestId: "r1", name: "write_note", phase: "start" }]);
    expect(norm(started.messages)).toEqual([
      { role: "assistant", streaming: true, blocks: [{ kind: "action", tool: "write_note", status: "pending" }] },
    ]);

    const ended = reduceEvents(started, { type: "tool", requestId: "r1", name: "write_note", phase: "end" });
    expect(norm(ended.messages)).toEqual([
      { role: "assistant", streaming: true, blocks: [{ kind: "action", tool: "write_note", status: "done" }] },
    ]);
  });

  it("creates a readonly action block for read-only tools (no permission flow)", () => {
    const started = run([{ type: "tool", requestId: "r1", name: "read_note", phase: "start" }]);
    // read_note 不进 permission 流，但仍产出 action block（渲染为紧凑行）。
    expect(norm(started.messages)).toEqual([
      { role: "assistant", streaming: true, blocks: [{ kind: "action", tool: "read_note", status: "pending" }] },
    ]);

    const ended = reduceEvents(started, { type: "tool", requestId: "r1", name: "read_note", phase: "end" });
    expect(norm(ended.messages)).toEqual([
      { role: "assistant", streaming: true, blocks: [{ kind: "action", tool: "read_note", status: "done" }] },
    ]);
  });

  it("keeps the action card as a record and adds a following text block", () => {
    const state = run([
      { type: "user", text: "整理一下" },
      { type: "tool", requestId: "r1", name: "write_note", phase: "start" },
      { type: "tool", requestId: "r1", name: "write_note", phase: "end" },
      { type: "delta", requestId: "r1", text: "已整理" },
      { type: "done", requestId: "r1" },
    ]);
    expect(norm(state.messages)).toEqual([
      { role: "user", text: "整理一下" },
      {
        role: "assistant", streaming: false,
        blocks: [
          { kind: "action", tool: "write_note", status: "done" },
          { kind: "text", text: "已整理", streaming: false },
        ],
      },
    ]);
  });

  it("opens a new text block after a thinking block", () => {
    const state = run([
      { type: "thinking_start", requestId: "r1", blockId: "t1" },
      { type: "thinking_delta", requestId: "r1", text: "推理" },
      { type: "thinking_end", requestId: "r1" },
      { type: "delta", requestId: "r1", text: "答案" },
    ]);
    expect(norm(state.messages)).toEqual([
      {
        role: "assistant", streaming: true,
        blocks: [
          { kind: "thinking", text: "推理", collapsed: true, done: true },
          { kind: "text", text: "答案", streaming: true },
        ],
      },
    ]);
  });

  it("fills action block detail on permission_request and resolves on permission_resolve", () => {
    const started = run([{ type: "tool", requestId: "r1", name: "edit_note", phase: "start" }]);
    const filled = reduceEvents(started, {
      type: "permission_request",
      requestId: "pe-1",
      toolName: "edit_note",
      detail: { kind: "diff", hunks: "- a\n+ b" },
      summary: "编辑文本",
      oldContent: "a",
      newContent: "b",
      canSnapshot: true,
    });
    const action = (filled.messages[0] as Extract<ChatMessage, { role: "assistant" }>).blocks[0];
    expect(action.kind).toBe("action");
    if (action.kind === "action") {
      expect(action.requestId).toBe("pe-1");
      expect(action.canSnapshot).toBe(true);
      expect(action.newContent).toBe("b");
      expect(action.status).toBe("pending");
    }

    const resolved = reduceEvents(filled, { type: "permission_resolve", requestId: "pe-1", decision: "allow" });
    const after = (resolved.messages[0] as Extract<ChatMessage, { role: "assistant" }>).blocks[0];
    if (after.kind === "action") expect(after.status).toBe("approved");
  });

  it("interleaves a full exchange", () => {
    const state = run([
      { type: "user", text: "在哪些场景有效？" },
      { type: "delta", requestId: "r1", text: "在数学" },
      { type: "delta", requestId: "r1", text: "推导时" },
      { type: "done", requestId: "r1" },
    ]);
    expect(norm(state.messages)).toEqual([
      { role: "user", text: "在哪些场景有效？" },
      { role: "assistant", streaming: false, blocks: [{ kind: "text", text: "在数学推导时", streaming: false }] },
    ]);
  });

  it("finalizes any open bubble and surfaces an error block alongside", () => {
    const state = run([
      { type: "delta", requestId: "r1", text: "half" },
      { type: "error", requestId: "r1", message: "助手已断开" },
    ]);
    expect(norm(state.messages)).toEqual([
      {
        role: "assistant", streaming: false,
        blocks: [
          { kind: "text", text: "half", streaming: false },
          { kind: "error", text: "助手已断开" },
        ],
      },
    ]);
  });

  it("ignores ready events", () => {
    const state = run([{ type: "ready" }]);
    expect(norm(state.messages)).toEqual([]);
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
    expect(norm(state.messages)).toEqual([
      { role: "user", text: "之前的问题" },
      { role: "assistant", streaming: false, blocks: [{ kind: "text", text: "之前的回答", streaming: false }] },
    ]);
  });

  it("ignores stream events for a non-active conversation", () => {
    const state = run([
      { type: "session_opened", conversationId: "visible", sessionFile: "/tmp/visible.jsonl", messages: [] },
      { type: "delta", requestId: "r1", conversationId: "hidden", text: "wrong" },
    ]);
    expect(norm(state.messages)).toEqual([]);
  });

  it("replaces pending only when the delta belongs to the active conversation", () => {
    const state = run([
      { type: "session_opened", conversationId: "c1", sessionFile: "/tmp/c1.jsonl", messages: [] },
      { type: "user", conversationId: "c1", text: "你好" },
      { type: "pending", conversationId: "c1" },
      { type: "delta", requestId: "r-other", conversationId: "other", text: "wrong" },
      { type: "delta", requestId: "r1", conversationId: "c1", text: "right" },
    ]);
    expect(norm(state.messages)).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", streaming: true, blocks: [{ kind: "text", text: "right", streaming: true }] },
    ]);
  });

  it("keeps optimistic messages when a same-session empty snapshot arrives late", () => {
    const state = run([
      { type: "session_opened", conversationId: "c1", sessionFile: "/tmp/c1.jsonl", messages: [] },
      { type: "user", conversationId: "c1", text: "新问题" },
      { type: "pending", conversationId: "c1" },
      { type: "session_opened", conversationId: "c1", sessionFile: "/tmp/c1.jsonl", messages: [] },
    ]);
    expect(norm(state.messages)).toEqual([
      { role: "user", text: "新问题" },
      { role: "assistant", streaming: true, pending: true, blocks: [{ kind: "text", text: "正在思考…", streaming: true }] },
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
