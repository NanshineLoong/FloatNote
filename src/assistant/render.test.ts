import { describe, it, expect } from "vitest";
import { type ChatState, type ChatMessage, emptyChat, reduceEvents, isChatStreaming } from "./render";

function run(events: Parameters<typeof reduceEvents>[1][]): ChatState {
  return events.reduce(reduceEvents, emptyChat());
}

/** 归一化：去掉生成的 id（消息/块），便于值比较。 */
function norm(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", text: m.text, ...(m.references ? { references: m.references } : {}) };
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

  it("keeps submitted file and Skill references on the user message", () => {
    const state = run([{
      type: "user",
      text: "请整理",
      references: [
        { kind: "file", id: "piece.md", display: "piece.md" },
        { kind: "skill", id: "summarize", display: "summarize" },
      ],
    }]);
    expect(norm(state.messages)).toEqual([{
      role: "user",
      text: "请整理",
      references: [
        { kind: "file", id: "piece.md", display: "piece.md" },
        { kind: "skill", id: "summarize", display: "summarize" },
      ],
    }]);
  });

  it("replaces one user message text while retaining its references", () => {
    const state = run([
      { type: "user", text: "old", references: [{ kind: "file", id: "piece.md", display: "piece.md" }] },
      { type: "user", text: "later" },
    ]);
    const first = state.messages[0];
    if (first.role !== "user") throw new Error("expected user message");

    const edited = reduceEvents(state, { type: "user_edit", messageId: first.id, text: "new" });

    expect(norm(edited.messages)).toEqual([
      { role: "user", text: "new", references: [{ kind: "file", id: "piece.md", display: "piece.md" }] },
      { role: "user", text: "later" },
    ]);
    expect(edited.messages[1]).toBe(state.messages[1]);
  });

  it("rewinds a user turn and removes every following message", () => {
    const state = run([
      { type: "user", text: "first" },
      { type: "delta", requestId: "r1", text: "answer" },
      { type: "done", requestId: "r1" },
      { type: "user", text: "second", references: [{ kind: "file", id: "piece.md", display: "piece.md" }] },
      { type: "delta", requestId: "r2", text: "later answer" },
      { type: "done", requestId: "r2" },
    ]);
    const first = state.messages[0];
    if (first.role !== "user") throw new Error("expected user message");

    const rewound = reduceEvents(state, { type: "user_rewind", messageId: first.id, text: "again" });

    expect(norm(rewound.messages)).toEqual([{ role: "user", text: "again" }]);
  });

  it("keeps the stable session entry id when rewinding a user turn", () => {
    const state = run([{ type: "session_opened", conversationId: "c1", sessionFile: "session.jsonl", messages: [
      { role: "user", text: "old", timestamp: 0, entryId: "u1" },
    ] }]);
    const user = state.messages[0];
    if (user.role !== "user") throw new Error("expected user message");

    const rewound = reduceEvents(state, { type: "user_rewind", messageId: user.id, text: "new" });

    expect(rewound.messages[0]).toMatchObject({ role: "user", text: "new", sessionEntryId: "u1" });
  });

  it("shows a lightweight wait block instead of an assistant text bubble", () => {
    const state = run([{ type: "user", text: "你好" }, { type: "pending" }]);
    expect(norm(state.messages)).toEqual([
      { role: "user", text: "你好" },
      { role: "assistant", streaming: true, pending: true, blocks: [{ kind: "wait", label: "正在准备回复…" }] },
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
    const started = run([{ type: "tool", requestId: "r1", callId: "call-1", name: "write_note", phase: "start", args: { target: "piece.md" } }]);
    expect(norm(started.messages)).toEqual([
      { role: "assistant", streaming: true, blocks: [{ kind: "action", callId: "call-1", tool: "write_note", targets: ["piece.md"], decision: "pending", execution: "running" }] },
    ]);

    const ended = reduceEvents(started, { type: "tool", requestId: "r1", callId: "call-1", name: "write_note", phase: "end", result: "ok", isError: false });
    expect(norm(ended.messages)).toEqual([
      { role: "assistant", streaming: true, blocks: [{ kind: "action", callId: "call-1", tool: "write_note", targets: ["piece.md"], decision: "pending", execution: "succeeded" }] },
    ]);
  });

  it("matches interleaved tool results by call id instead of the most recent action", () => {
    let state = run([
      { type: "tool", requestId: "r1", callId: "read-1", name: "read_note", phase: "start", args: { target: "piece.md" } },
      { type: "tool", requestId: "r1", callId: "read-2", name: "read_note", phase: "start", args: { target: "ideas.md" } },
    ]);
    state = reduceEvents(state, { type: "tool", requestId: "r1", callId: "read-1", name: "read_note", phase: "end", result: "first", isError: false });
    const blocks = (state.messages[0] as Extract<ChatMessage, { role: "assistant" }>).blocks;
    expect(blocks[0]).toMatchObject({ kind: "action", callId: "read-1", execution: "succeeded" });
    expect(blocks[1]).toMatchObject({ kind: "action", callId: "read-2", execution: "running" });
  });

  it("groups three consecutive read tools and starts a new segment after text", () => {
    const state = run([
      { type: "tool", requestId: "r1", callId: "a", name: "read_note", phase: "start", args: { target: "a.md" } },
      { type: "tool", requestId: "r1", callId: "b", name: "read_note", phase: "start", args: { target: "b.md" } },
      { type: "tool", requestId: "r1", callId: "c", name: "read_note", phase: "start", args: { target: "c.md" } },
      { type: "delta", requestId: "r1", text: "阶段说明" },
      { type: "tool", requestId: "r1", callId: "d", name: "read_note", phase: "start", args: { target: "d.md" } },
    ]);
    const blocks = (state.messages[0] as Extract<ChatMessage, { role: "assistant" }>).blocks;
    expect(blocks[0]).toMatchObject({ kind: "action_group", category: "read", summary: "读取 3 个文件" });
    if (blocks[0].kind === "action_group") expect(blocks[0].items).toHaveLength(3);
    expect(blocks[1]).toMatchObject({ kind: "text", text: "阶段说明" });
    expect(blocks[2]).toMatchObject({ kind: "action", callId: "d" });
  });

  it("creates a readonly action block for read-only tools (no permission flow)", () => {
    const started = run([{ type: "tool", requestId: "r1", name: "read_note", phase: "start" }]);
    // read_note 不进 permission 流，但仍产出 action block（渲染为紧凑行）。
    expect(norm(started.messages)).toEqual([
      { role: "assistant", streaming: true, blocks: [{ kind: "action", tool: "read_note", targets: [], decision: "pending", execution: "running" }] },
    ]);

    const ended = reduceEvents(started, { type: "tool", requestId: "r1", name: "read_note", phase: "end" });
    expect(norm(ended.messages)).toEqual([
      { role: "assistant", streaming: true, blocks: [{ kind: "action", tool: "read_note", targets: [], decision: "pending", execution: "succeeded" }] },
    ]);
  });

  it("keeps only a compact completed tool result and adds a following text block", () => {
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
          { kind: "action", tool: "write_note", targets: [], decision: "pending", execution: "succeeded" },
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

  it("keeps permission details out of the conversation flow", () => {
    const started = run([{ type: "tool", requestId: "r1", callId: "call-1", name: "edit_note", phase: "start", args: { target: "piece.md" } }]);
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
      expect(action.requestId).toBeUndefined();
      expect(action.detail).toBeUndefined();
      expect(action.decision).toBe("pending");
    }

    const resolved = reduceEvents(filled, { type: "permission_resolve", requestId: "pe-1", decision: "allow" });
    const after = (resolved.messages[0] as Extract<ChatMessage, { role: "assistant" }>).blocks[0];
    if (after.kind === "action") {
      expect(after.decision).toBe("pending");
      expect(after.execution).toBe("running");
    }

    const ended = reduceEvents(resolved, { type: "tool", requestId: "r1", callId: "call-1", name: "edit_note", phase: "end", result: "written", isError: false });
    const finalBlock = (ended.messages[0] as Extract<ChatMessage, { role: "assistant" }>).blocks[0];
    expect(finalBlock).toMatchObject({ kind: "action", decision: "pending", execution: "succeeded" });
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
      { role: "assistant", streaming: true, pending: true, blocks: [{ kind: "wait", label: "正在准备回复…" }] },
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
