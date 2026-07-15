import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { AgentRunner, rewindSessionToUserTurn, translateEvent } from "./agent.js";
import type { SessionLike } from "./agent.js";
import { displayMessagesFromSession } from "./runner.js";
import type { SidecarToHost } from "./protocol.js";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatSkillsForSystemPrompt } from "./skills.js";

const ev = (e: unknown): AgentSessionEvent => e as AgentSessionEvent;

describe("translateEvent", () => {
  it("maps a text_delta message_update to a delta line", () => {
    const out = translateEvent("r1", "c1", ev({
      type: "message_update",
      message: {},
      assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hi", partial: {} },
    }));
    expect(out).toEqual({ type: "delta", requestId: "r1", conversationId: "c1", text: "hi" });
  });

  it("maps thinking_start/delta/end to thinking block lines", () => {
    expect(
      translateEvent("r1", "c1", ev({
        type: "message_update",
        message: {},
        assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial: {} },
      })),
    ).toEqual({ type: "thinking_start", requestId: "r1", conversationId: "c1", blockId: "r1-t0" });
    expect(
      translateEvent("r1", "c1", ev({
        type: "message_update",
        message: {},
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "...", partial: {} },
      })),
    ).toEqual({ type: "thinking_delta", requestId: "r1", conversationId: "c1", text: "..." });
    expect(
      translateEvent("r1", "c1", ev({
        type: "message_update",
        message: {},
        assistantMessageEvent: { type: "thinking_end", contentIndex: 0, partial: {} },
      })),
    ).toEqual({ type: "thinking_end", requestId: "r1", conversationId: "c1" });
  });

  it("opens a generic tool placeholder when the model starts a tool call", () => {
    const out = translateEvent("r1", "c1", ev({
      type: "message_update",
      message: {},
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 0,
        partial: { content: [{ type: "toolCall", id: "call-1", name: "read_note", arguments: {} }] },
      },
    }));
    expect(out).toEqual({
      type: "tool",
      requestId: "r1",
      conversationId: "c1",
      callId: "call-1",
      name: "read_note",
      label: "正在准备工具调用…",
      phase: "prepare",
    });
  });

  it("maps tool execution start/end to tool lines", () => {
    expect(
      translateEvent("r1", "c1", ev({ type: "tool_execution_start", toolCallId: "c", toolName: "write_note", args: { target: "piece.md" } })),
    ).toEqual({ type: "tool", requestId: "r1", conversationId: "c1", callId: "c", name: "write_note", label: "编辑 piece.md", phase: "start" });
    expect(
      translateEvent("r1", "c1", ev({ type: "tool_execution_end", toolCallId: "c", toolName: "write_note", result: {}, isError: false })),
    ).toEqual({ type: "tool", requestId: "r1", conversationId: "c1", callId: "c", name: "write_note", phase: "end", isError: false });
  });

  it("maps a completed agent_end to a completed done line", () => {
    expect(translateEvent("r1", "c1", ev({ type: "agent_end", messages: [], willRetry: false }))).toEqual({
      type: "done",
      requestId: "r1",
      conversationId: "c1",
      outcome: "completed",
    });
  });

  it("ignores an agent_end that the session will retry", () => {
    expect(translateEvent("r1", "c1", ev({
      type: "agent_end",
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "temporary", content: [] }],
      willRetry: true,
    }))).toBeNull();
  });

  it("preserves cancellation as a distinct done outcome", () => {
    expect(translateEvent("r1", "c1", ev({
      type: "agent_end",
      messages: [{ role: "assistant", stopReason: "aborted", content: [] }],
      willRetry: false,
    }))).toEqual({
      type: "done",
      requestId: "r1",
      conversationId: "c1",
      outcome: "cancelled",
    });
  });

  it("preserves a model failure and its message as a failed done outcome", () => {
    expect(translateEvent("r1", "c1", ev({
      type: "agent_end",
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "额度不足", content: [] }],
      willRetry: false,
    }))).toEqual({
      type: "done",
      requestId: "r1",
      conversationId: "c1",
      outcome: "failed",
      error: "额度不足",
    });
  });
});

describe("displayMessagesFromSession", () => {
  it("restores ordered thinking, text and matched tool calls without result bodies", () => {
    const session = {
      sessionManager: {
        getBranch: () => [
          { id: "u1", type: "message", timestamp: "2026-07-12T00:00:00.000Z", message: { role: "user", content: "问题" } },
          { id: "a1", type: "message", timestamp: "2026-07-12T00:00:01.000Z", message: { role: "assistant", content: [
            { type: "thinking", thinking: "先读取" },
            { type: "toolCall", id: "call-1", name: "read_note", arguments: { target: { kind: "tasks" }, content: "不得泄露" } },
            { type: "text", text: "完成" },
            { type: "toolCall", id: "call-2", name: "web_fetch", arguments: { url: "https://example.com/a" } },
          ] } },
          { id: "tr1", type: "message", timestamp: "2026-07-12T00:00:02.000Z", message: { role: "toolResult", toolCallId: "call-1", content: "大段工具返回", isError: false } },
          { id: "tr2", type: "message", timestamp: "2026-07-12T00:00:03.000Z", message: { role: "toolResult", toolCallId: "call-2", content: "network denied\nresponse body", isError: true } },
        ],
      },
    } as SessionLike;
    expect(displayMessagesFromSession(session)).toEqual([
      { role: "user", text: "问题", timestamp: expect.any(Number), entryId: "u1" },
      { role: "assistant", timestamp: expect.any(Number), entryId: "a1", blocks: [
        { type: "thinking", text: "先读取" },
        { type: "tool", callId: "call-1", name: "read_note", label: "读取 行动清单", status: "succeeded" },
        { type: "text", text: "完成" },
        { type: "tool", callId: "call-2", name: "web_fetch", label: "读取网页 example.com", status: "failed", error: "network denied" },
      ] },
    ]);
    expect(JSON.stringify(displayMessagesFromSession(session))).not.toContain("大段工具返回");
    expect(JSON.stringify(displayMessagesFromSession(session))).not.toContain("不得泄露");
  });

  it("marks a tool without a result as incomplete", () => {
    const session = { sessionManager: { getBranch: () => [
      { id: "a1", type: "message", timestamp: "2026-07-12T00:00:01.000Z", message: { role: "assistant", content: [
        { type: "toolCall", id: "call-1", name: "read_note", arguments: {} },
      ] } },
    ] } } as SessionLike;
    expect(displayMessagesFromSession(session)).toEqual([
      { role: "assistant", timestamp: expect.any(Number), entryId: "a1", blocks: [
        { type: "tool", callId: "call-1", name: "read_note", label: "读取当前文档", status: "incomplete" },
      ] },
    ]);
  });

  it("merges assistant continuation entries around tool results into one ordered turn", () => {
    const session = { sessionManager: { getBranch: () => [
      { id: "u1", type: "message", timestamp: "2026-07-12T00:00:00.000Z", message: { role: "user", content: "问题" } },
      { id: "a1", type: "message", timestamp: "2026-07-12T00:00:01.000Z", message: { role: "assistant", content: [
        { type: "thinking", thinking: "先看" },
        { type: "toolCall", id: "c1", name: "read_note", arguments: {} },
      ] } },
      { id: "tr1", type: "message", timestamp: "2026-07-12T00:00:02.000Z", message: { role: "toolResult", toolCallId: "c1", content: [{ type: "text", text: "secret" }], isError: false } },
      { id: "a2", type: "message", timestamp: "2026-07-12T00:00:03.000Z", message: { role: "assistant", content: [{ type: "text", text: "结论" }] } },
    ] } } as SessionLike;
    const messages = displayMessagesFromSession(session);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ role: "assistant", entryId: "a1", blocks: [
      { type: "thinking", text: "先看" },
      { type: "tool", callId: "c1", status: "succeeded" },
      { type: "text", text: "结论" },
    ] });
  });
});

describe("session restoration", () => {
  it("rejects a missing session file instead of creating a blank conversation", async () => {
    const root = mkdtempSync(join(tmpdir(), "floatnote-missing-session-"));
    const missing = join(root, "missing.jsonl");
    const runner = new AgentRunner({
      send: () => {},
      createSession: async () => fakeSession(() => {}).session,
    });
    await runner.configure({ provider: "openai", model: "gpt-5", apiKey: "test" });

    await expect(runner.openSession({ conversationId: "c1", sessionFile: missing }))
      .rejects.toThrow("conversation session file not found");
    expect(existsSync(missing)).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

describe("rewindSessionToUserTurn", () => {
  it("branches immediately before the selected user message", () => {
    const branch = [
      { id: "u1", parentId: null, type: "message", message: { role: "user" } },
      { id: "a1", parentId: "u1", type: "message", message: { role: "assistant" } },
      { id: "u2", parentId: "a1", type: "message", message: { role: "user" } },
    ];
    const calls: string[] = [];
    rewindSessionToUserTurn({ getBranch: () => branch, branch: (id) => calls.push(id), resetLeaf: () => calls.push("reset") }, "u2");
    expect(calls).toEqual(["a1"]);
  });

  it("resets the leaf when rewinding the first user message", () => {
    const branch = [{ id: "u1", parentId: null, type: "message", message: { role: "user" } }];
    const calls: string[] = [];
    rewindSessionToUserTurn({ getBranch: () => branch, branch: (id) => calls.push(id), resetLeaf: () => calls.push("reset") }, "u1");
    expect(calls).toEqual(["reset"]);
  });
});

/** Fake session that replays a scripted event stream when prompted. */
function fakeSession(script: (emit: (e: AgentSessionEvent) => void) => Promise<void> | void): {
  session: SessionLike;
} {
  let listener: ((e: AgentSessionEvent) => void) | undefined;
  const session: SessionLike = {
    subscribe(l) {
      listener = l;
      return () => {
        listener = undefined;
      };
    },
    async prompt() {
      await script((e) => listener?.(e));
    },
    async abort() {},
  };
  return { session };
}

describe("AgentRunner", () => {
  it("rebuilds existing sessions atomically when the provider changes", async () => {
    const configs: string[] = [];
    const disposed: string[] = [];
    let sequence = 0;
    const runner = new AgentRunner({
      send: () => {},
      createSession: async (cfg) => {
        const id = `${cfg.provider}-${++sequence}`;
        configs.push(id);
        const { session } = fakeSession(() => {});
        session.dispose = () => disposed.push(id);
        return session;
      },
    });
    await runner.configure({ provider: "openai", model: "gpt-5", apiKey: "old" });
    await runner.newSession({ conversationId: "c1", cwd: process.cwd(), sessionDir: "/tmp/floatnote-test-sessions" });

    await runner.configure({ provider: "deepseek", model: "deepseek-chat", apiKey: "new" });

    expect(configs).toEqual(["openai-1", "deepseek-2"]);
    expect(disposed).toEqual(["openai-1"]);
  });

  it("keeps existing sessions when a provider reconfiguration fails", async () => {
    const disposed: string[] = [];
    const runner = new AgentRunner({
      send: () => {},
      createSession: async (cfg) => {
        if (cfg.provider === "deepseek") throw new Error("invalid credentials");
        const { session } = fakeSession(() => {});
        session.dispose = () => disposed.push(cfg.provider);
        return session;
      },
    });
    await runner.configure({ provider: "openai", model: "gpt-5", apiKey: "old" });
    await runner.newSession({ conversationId: "c1", cwd: process.cwd(), sessionDir: "/tmp/floatnote-test-sessions" });

    await expect(runner.configure({ provider: "deepseek", model: "deepseek-chat", apiKey: "new" }))
      .rejects.toThrow("invalid credentials");
    expect(disposed).toEqual([]);
  });

  it("streams a scripted event sequence to send() as delta… → done", async () => {
    const sent: SidecarToHost[] = [];
    const { session } = fakeSession((emit) => {
      emit(ev({ type: "message_update", message: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Hel", partial: {} } }));
      emit(ev({ type: "message_update", message: {}, assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "lo", partial: {} } }));
      emit(ev({ type: "agent_end", messages: [], willRetry: false }));
    });

    const runner = new AgentRunner({
      send: (m) => sent.push(m),
      createSession: async () => session,
    });
    await runner.configure({ provider: "anthropic", model: "claude-opus-4-5", apiKey: "k" });
    await runner.newSession({ conversationId: "c1", cwd: process.cwd(), sessionDir: "/tmp/floatnote-test-sessions" });
    await runner.prompt({ requestId: "r1", conversationId: "c1", userText: "hi" });

    expect(sent).toEqual([
      { type: "session_opened", conversationId: "c1", sessionFile: expect.any(String), messages: [] },
      { type: "delta", requestId: "r1", conversationId: "c1", text: "Hel" },
      { type: "delta", requestId: "r1", conversationId: "c1", text: "lo" },
      { type: "done", requestId: "r1", conversationId: "c1", outcome: "completed" },
      { type: "session_synced", conversationId: "c1", sessionFile: expect.any(String), messages: [] },
    ]);
  });

  it("assigns distinct thinking block ids when Pi restarts content indices after a tool", async () => {
    const sent: SidecarToHost[] = [];
    const { session } = fakeSession((emit) => {
      emit(ev({ type: "message_update", message: {}, assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial: {} } }));
      emit(ev({ type: "message_update", message: {}, assistantMessageEvent: { type: "thinking_end", contentIndex: 0, partial: {} } }));
      emit(ev({ type: "tool_execution_start", toolCallId: "c1", toolName: "read_note", args: {} }));
      emit(ev({ type: "tool_execution_end", toolCallId: "c1", toolName: "read_note", result: {}, isError: false }));
      emit(ev({ type: "message_update", message: {}, assistantMessageEvent: { type: "thinking_start", contentIndex: 0, partial: {} } }));
      emit(ev({ type: "agent_end", messages: [], willRetry: false }));
    });

    const runner = new AgentRunner({ send: (message) => sent.push(message), createSession: async () => session });
    await runner.configure({ provider: "anthropic", model: "claude-opus-4-5", apiKey: "k" });
    await runner.newSession({ conversationId: "c1", cwd: process.cwd(), sessionDir: "/tmp/floatnote-test-sessions" });
    await runner.prompt({ requestId: "r1", conversationId: "c1", userText: "hi" });

    expect(sent.filter((message) => message.type === "thinking_start").map((message) => message.blockId))
      .toEqual(["r1-t0", "r1-t1"]);
  });

  it("emits a diagnostic error when a turn ends without visible output", async () => {
    const sent: SidecarToHost[] = [];
    const { session } = fakeSession((emit) => {
      emit(ev({ type: "agent_end", messages: [], willRetry: false }));
    });

    const runner = new AgentRunner({
      send: (m) => sent.push(m),
      createSession: async () => session,
    });
    await runner.configure({ provider: "anthropic", model: "claude-opus-4-5", apiKey: "k" });
    await runner.newSession({ conversationId: "c1", cwd: process.cwd(), sessionDir: "/tmp/floatnote-test-sessions" });
    await runner.prompt({ requestId: "r1", conversationId: "c1", userText: "hi" });

    expect(sent).toEqual([
      { type: "session_opened", conversationId: "c1", sessionFile: expect.any(String), messages: [] },
      {
        type: "error",
        requestId: "r1",
        conversationId: "c1",
        message: "助手这次没有返回内容。请检查模型名称、API Key、服务商额度或网络连接后重试。",
      },
      { type: "done", requestId: "r1", conversationId: "c1", outcome: "completed" },
      { type: "session_synced", conversationId: "c1", sessionFile: expect.any(String), messages: [] },
    ]);
  });

  it("does not diagnose an empty response when the user cancelled before output", async () => {
    const sent: SidecarToHost[] = [];
    const { session } = fakeSession((emit) => {
      emit(ev({
        type: "agent_end",
        messages: [{ role: "assistant", stopReason: "aborted", content: [] }],
        willRetry: false,
      }));
    });
    const runner = new AgentRunner({ send: (message) => sent.push(message), createSession: async () => session });
    await runner.configure({ provider: "anthropic", model: "claude-opus-4-5", apiKey: "k" });
    await runner.newSession({ conversationId: "c1", cwd: process.cwd(), sessionDir: "/tmp/floatnote-test-sessions" });

    await runner.prompt({ requestId: "r1", conversationId: "c1", userText: "hi" });

    expect(sent.filter((message) => message.type === "error")).toEqual([]);
    expect(sent).toContainEqual({
      type: "done",
      requestId: "r1",
      conversationId: "c1",
      outcome: "cancelled",
    });
  });

  it("surfaces the model error instead of diagnosing an empty response", async () => {
    const sent: SidecarToHost[] = [];
    const { session } = fakeSession((emit) => {
      emit(ev({
        type: "agent_end",
        messages: [{ role: "assistant", stopReason: "error", errorMessage: "服务商额度不足", content: [] }],
        willRetry: false,
      }));
    });
    const runner = new AgentRunner({ send: (message) => sent.push(message), createSession: async () => session });
    await runner.configure({ provider: "anthropic", model: "claude-opus-4-5", apiKey: "k" });
    await runner.newSession({ conversationId: "c1", cwd: process.cwd(), sessionDir: "/tmp/floatnote-test-sessions" });

    await runner.prompt({ requestId: "r1", conversationId: "c1", userText: "hi" });

    expect(sent).toContainEqual({
      type: "error",
      requestId: "r1",
      conversationId: "c1",
      message: "服务商额度不足",
    });
    expect(sent.some((message) => message.type === "error" && message.message.startsWith("助手这次没有返回内容"))).toBe(false);
  });

  it("uses a Chinese error when a session is opened before configuration", async () => {
    const runner = new AgentRunner({ send: () => {} });
    await expect(runner.newSession({
      conversationId: "c1",
      cwd: process.cwd(),
      sessionDir: "/tmp/floatnote-test-sessions",
    })).rejects.toThrow("尚未配置或启用 AI 提供商");
  });

  it("emits apply_edit when the model writes, and resolves on the host result", async () => {
    const sent: SidecarToHost[] = [];
    let capturedWriteText: string | undefined;

    // Script: during prompt, invoke write_note exactly like the model would.
    const { session } = fakeSession(async (emit) => {
      const writeTool = capturedTools!.find((t) => t.name === "write_note")!;
      emit(ev({ type: "tool_execution_start", toolCallId: "c1", toolName: "write_note", args: {} }));
      const result = await writeTool.execute("c1", { content: "tidied note" } as never, undefined, undefined, {} as never);
      capturedWriteText = (result.content[0] as { text: string }).text;
      emit(ev({ type: "tool_execution_end", toolCallId: "c1", toolName: "write_note", result: {}, isError: false }));
      emit(ev({ type: "agent_end", messages: [], willRetry: false }));
    });

    let capturedTools: ToolDefinition[] | undefined;
    const runner = new AgentRunner({
      send: (m) => {
        sent.push(m);
        // Host responds to get_note_text and apply_edit out-of-band.
        if (m.type === "get_note_text") {
          runner.onNoteText({ type: "note_text", callId: m.callId, content: "old doc", found: true });
        } else if (m.type === "apply_edit") {
          runner.onApplyEditResult({ type: "apply_edit_result", callId: m.callId, ok: true, version: 4 });
        }
      },
      createSession: async (_cfg, tools) => {
        capturedTools = tools;
        return session;
      },
    });
    await runner.configure({ provider: "anthropic", model: "claude-opus-4-5", apiKey: "k" });
    await runner.newSession({ conversationId: "c1", cwd: process.cwd(), sessionDir: "/tmp/floatnote-test-sessions" });
    await runner.prompt({ requestId: "r1", conversationId: "c1", userText: "整理一下" });

    const applyEdit = sent.find((m) => m.type === "apply_edit");
    // write_note 未带 target → apply_edit 应省略 target 字段（由 Rust 解析为活动笔记）。
    expect(applyEdit).toEqual({
      type: "apply_edit",
      callId: expect.any(String),
      conversationId: "c1",
      toolCallId: "c1",
      toolName: "write_note",
      oldContent: "old doc",
      newContent: "tidied note",
      preview: expect.objectContaining({ tool: "write_note", summary: "整篇覆写" }),
    });
    expect(applyEdit).not.toHaveProperty("target");
    expect(capturedWriteText).toBe("已更新，版本 v4");
    expect(capturedWriteText).not.toBeUndefined();
  });

  it("surfaces a denied write as a user-denied tool result", async () => {
    const sent: SidecarToHost[] = [];
    let capturedWriteText: string | undefined;

    const { session } = fakeSession(async (emit) => {
      const writeTool = capturedTools!.find((t) => t.name === "write_note")!;
      emit(ev({ type: "tool_execution_start", toolCallId: "c1", toolName: "write_note", args: {} }));
      const result = await writeTool.execute("c1", { content: "nope" } as never, undefined, undefined, {} as never);
      capturedWriteText = (result.content[0] as { text: string }).text;
      emit(ev({ type: "tool_execution_end", toolCallId: "c1", toolName: "write_note", result: {}, isError: false }));
      emit(ev({ type: "agent_end", messages: [], willRetry: false }));
    });

    let capturedTools: ToolDefinition[] | undefined;
    const runner = new AgentRunner({
      send: (m) => {
        sent.push(m);
        if (m.type === "get_note_text") {
          runner.onNoteText({ type: "note_text", callId: m.callId, content: "", found: true });
        } else if (m.type === "apply_edit") {
          runner.onApplyEditResult({ type: "apply_edit_result", callId: m.callId, ok: false, denied: true });
        }
      },
      createSession: async (_cfg, tools) => {
        capturedTools = tools;
        return session;
      },
    });
    await runner.configure({ provider: "anthropic", model: "claude-opus-4-5", apiKey: "k" });
    await runner.newSession({ conversationId: "c1", cwd: process.cwd(), sessionDir: "/tmp/floatnote-test-sessions" });
    await runner.prompt({ requestId: "r1", conversationId: "c1", userText: "整理一下" });

    expect(capturedWriteText).toBe("用户拒绝了此操作");
  });
});

describe("AgentRunner getNoteText round-trip", () => {
  it("resolves getNoteText from note_text reply", async () => {
    const sent: SidecarToHost[] = [];
    const { session } = fakeSession(async () => {});
    const runner = new AgentRunner({
      send: (m) => { sent.push(m); },
      createSession: async () => session,
    });
    await runner.configure({ provider: "anthropic", model: "x" });
    await runner.newSession({ conversationId: "c1", cwd: process.cwd(), sessionDir: "/tmp/floatnote-test-sessions" });

    const p = (runner as unknown as { getNoteText: (id: string, t?: { kind: string }) => Promise<string> }).getNoteText("c1", { kind: "inbox" });
    expect(sent.at(-1)?.type).toBe("get_note_text");
    const last = sent.at(-1) as { callId: string };
    (runner as unknown as { onNoteText: (m: { type: "note_text"; callId: string; content: string; found: boolean }) => void }).onNoteText({ type: "note_text", callId: last.callId, content: "doc", found: true });
    await expect(p).resolves.toBe("doc");
  });
});

describe("AgentRunner skills", () => {
  function writeSkill(root: string, name: string, description: string): string {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n正文`);
    return dir;
  }

  it("listSkills reflects skills delivered via setSkillPaths", async () => {
    const root = mkdtempSync(join(tmpdir(), "floatnote-agent-skills-"));
    writeSkill(root, "socratic-review", "追问");
    const { session } = fakeSession(async () => {});
    const runner = new AgentRunner({ send: () => {}, createSession: async () => session });
    await runner.setSkillPaths([root]);
    expect(runner.listSkills()).toEqual([{ name: "socratic-review", description: "追问" }]);
    rmSync(root, { recursive: true, force: true });
  });

  it("passes /skill:name args verbatim to session.prompt (native expansion)", async () => {
    const sent: SidecarToHost[] = [];
    let prompted: string | undefined;
    const { session } = fakeSession(async () => {
      // no events; just capture the prompt arg
    });
    // override prompt to capture the text
    (session as { prompt: (t: string) => Promise<void> }).prompt = async (text: string) => {
      prompted = text;
    };
    const runner = new AgentRunner({ send: (m) => sent.push(m), createSession: async () => session });
    await runner.configure({ provider: "anthropic", model: "x" });
    await runner.newSession({ conversationId: "c1", cwd: process.cwd(), sessionDir: "/tmp/floatnote-test-sessions" });
    await runner.prompt({ requestId: "r1", conversationId: "c1", userText: "/skill:socratic-review 帮我审一下这篇" });
    expect(prompted).toBe("/skill:socratic-review 帮我审一下这篇");
  });
});

describe("defaultCreateSession wiring", () => {
  it("formatSkillsForSystemPrompt surfaces a loaded skill's description", async () => {
    const root = mkdtempSync(join(tmpdir(), "floatnote-agent-skills-"));
    mkdirSync(join(root, "x"), { recursive: true });
    writeFileSync(join(root, "x", "SKILL.md"), "---\nname: x\ndescription: 描述X\n---\n正文");
    const runner = new AgentRunner({ send: () => {}, createSession: async () => fakeSession(async () => {}).session });
    await runner.setSkillPaths([root]);
    expect(formatSkillsForSystemPrompt()).toContain("描述X");
    rmSync(root, { recursive: true, force: true });
  });
});
