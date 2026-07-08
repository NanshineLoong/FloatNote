import { describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { AgentRunner, buildAgentModel, translateEvent } from "./agent.js";
import type { SessionLike } from "./agent.js";
import type { SidecarToHost } from "./protocol.js";

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

  it("ignores non-text assistant message events", () => {
    const out = translateEvent("r1", "c1", ev({
      type: "message_update",
      message: {},
      assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "...", partial: {} },
    }));
    expect(out).toBeNull();
  });

  it("maps tool execution start/end to tool lines", () => {
    expect(
      translateEvent("r1", "c1", ev({ type: "tool_execution_start", toolCallId: "c", toolName: "write_note", args: {} })),
    ).toEqual({ type: "tool", requestId: "r1", conversationId: "c1", name: "write_note", phase: "start" });
    expect(
      translateEvent("r1", "c1", ev({ type: "tool_execution_end", toolCallId: "c", toolName: "write_note", result: {}, isError: false })),
    ).toEqual({ type: "tool", requestId: "r1", conversationId: "c1", name: "write_note", phase: "end" });
  });

  it("maps agent_end to a done line", () => {
    expect(translateEvent("r1", "c1", ev({ type: "agent_end", messages: [], willRetry: false }))).toEqual({
      type: "done",
      requestId: "r1",
      conversationId: "c1",
    });
  });
});

describe("buildAgentModel", () => {
  it("builds an OpenAI-compatible custom model when baseUrl is provided", () => {
    const model = buildAgentModel({
      provider: "openai",
      model: "qwen3.7-max",
      baseUrl: "https://example.aliyuncs.com/compatible-mode/v1/",
    });

    expect(model).toMatchObject({
      id: "qwen3.7-max",
      name: "qwen3.7-max",
      api: "openai-completions",
      provider: "openai",
      baseUrl: "https://example.aliyuncs.com/compatible-mode/v1",
      reasoning: false,
      input: ["text"],
    });
  });

  it("rejects Anthropic app endpoints for OpenAI-compatible custom models", () => {
    expect(() =>
      buildAgentModel({
        provider: "openai",
        model: "qwen3.7-max",
        baseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
      }),
    ).toThrow(/不是 OpenAI 兼容地址/);
  });

  it("throws a clear error for unknown built-in models without baseUrl", () => {
    expect(() =>
      buildAgentModel({
        provider: "openai",
        model: "qwen3.7-max",
      }),
    ).toThrow(/模型未在 PI 内置列表中找到/);
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
      { type: "done", requestId: "r1", conversationId: "c1" },
    ]);
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
      { type: "done", requestId: "r1", conversationId: "c1" },
    ]);
  });

  it("emits apply_write when the model writes, and resolves on the host result", async () => {
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
        // Host responds to the write request out-of-band.
        if (m.type === "apply_write") {
          runner.onApplyWriteResult({ type: "apply_write_result", callId: m.callId, ok: true, version: 4 });
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

    const applyWrite = sent.find((m) => m.type === "apply_write");
    expect(applyWrite).toEqual({ type: "apply_write", callId: expect.any(String), noteId: "c1", content: "tidied note" });
    expect(capturedWriteText).toBe("已更新笔记，版本 v4");
    expect(capturedWriteText).not.toBeUndefined();
  });
});
