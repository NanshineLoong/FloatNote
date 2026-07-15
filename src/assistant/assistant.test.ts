// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mountAssistant, type AssistantDeps } from "./assistant";
import type { AgentEvent } from "../platform/agent";
import type { ChatConversation } from "../platform/chat-history";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const conversation: ChatConversation = {
  id: "c1", sessionFile: "/notes/.chat.json", scopeType: "project", scopePath: "/notes", scopeLabel: "Notes",
  title: "新对话", titleState: "temporary", createdAt: 0, updatedAt: 0, lastOpenedAt: 0,
};

beforeAll(() => {
  if (!Range.prototype.getClientRects) {
    Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as DOMRectList;
  }
});

async function mountWithDeps(overrides: Partial<AssistantDeps> = {}) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  let emitAgent: (event: AgentEvent) => void = () => {};
  const deps: AssistantDeps = {
    send: vi.fn().mockResolvedValue("r2"),
    rewind: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    createConversation: vi.fn().mockResolvedValue(conversation),
    openConversation: vi.fn().mockResolvedValue(conversation),
    listConversations: vi.fn().mockResolvedValue([]),
    getLastConversation: vi.fn().mockResolvedValue(null),
    updateTitle: vi.fn().mockResolvedValue(conversation),
    subscribe: vi.fn((callback) => { emitAgent = callback; return () => {}; }),
    listSkills: vi.fn().mockResolvedValue([]),
    listFiles: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  const handle = mountAssistant(root, deps);
  await handle.openConversation(conversation);
  return { root, deps, emitAgent, handle };
}

describe("assistant message actions", () => {
  afterEach(() => document.body.replaceChildren());

  it("shows stop and cancels the active request while streaming", async () => {
    const cancel = vi.fn();
    const { root, emitAgent } = await mountWithDeps({ cancel });
    emitAgent({ type: "delta", requestId: "r1", conversationId: "c1", text: "partial" });
    const action = root.querySelector<HTMLButtonElement>(".assistant-send")!;
    expect(action.getAttribute("aria-label")).toBe("停止生成");
    action.click();
    expect(cancel).toHaveBeenCalledWith("r1");
  });

  it("reopens the active conversation after configuration becomes available", async () => {
    const openConversation = vi.fn().mockResolvedValue(conversation);
    const { root, emitAgent, handle } = await mountWithDeps({ openConversation });
    emitAgent({ type: "error", requestId: null, conversationId: "c1", message: "尚未配置或启用 AI 提供商" });
    expect(root.querySelector(".chat-block-error")?.textContent).toContain("尚未配置");

    await handle.refreshConversation();
    expect(openConversation).toHaveBeenCalledTimes(2);

    emitAgent({ type: "session_opened", conversationId: "c1", sessionFile: conversation.sessionFile, messages: [] });
    expect(root.querySelector(".chat-block-error")).toBeNull();
  });

  it("does not show a stale refresh error after switching conversations", async () => {
    const other = { ...conversation, id: "c2", sessionFile: "/notes/.chat-2.json" };
    let rejectRefresh!: (error: Error) => void;
    let calls = 0;
    const openConversation = vi.fn((selected: ChatConversation) => {
      calls += 1;
      if (calls === 2) {
        return new Promise<ChatConversation>((_resolve, reject) => { rejectRefresh = reject; });
      }
      return Promise.resolve(selected);
    });
    const { root, handle } = await mountWithDeps({ openConversation });

    const refresh = handle.refreshConversation();
    await Promise.resolve();
    await handle.openConversation(other);
    rejectRefresh(new Error("旧会话打开失败"));
    await refresh;

    expect(root.dataset.conversationId).toBe("c2");
    expect(root.querySelector(".chat-block-error")).toBeNull();
  });

  it("resends the selected user message", async () => {
    const send = vi.fn().mockResolvedValue("r2");
    const rewind = vi.fn().mockResolvedValue(undefined);
    const { root, emitAgent } = await mountWithDeps({ send, rewind });
    emitAgent({ type: "session_opened", conversationId: "c1", sessionFile: conversation.sessionFile, messages: [{ role: "user", text: "again", timestamp: 0, entryId: "u1" }] });
    root.querySelector<HTMLButtonElement>(".chat-retry-btn")!.click();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ userText: "again", references: [] }, "c1"));
    expect(rewind).toHaveBeenCalledWith("c1", "u1");
    expect(root.querySelectorAll(".chat-msg.chat-user")).toHaveLength(1);
  });

  it("sends edited user text and replaces the bubble", async () => {
    const send = vi.fn().mockResolvedValue("r3");
    const rewind = vi.fn().mockResolvedValue(undefined);
    const { root, emitAgent } = await mountWithDeps({ send, rewind });
    emitAgent({ type: "session_opened", conversationId: "c1", sessionFile: conversation.sessionFile, messages: [{ role: "user", text: "before", timestamp: 0, entryId: "u1" }] });
    root.querySelector<HTMLButtonElement>(".chat-edit-btn")!.click();
    const input = root.querySelector<HTMLTextAreaElement>(".chat-user-edit-input")!;
    input.value = "after";
    root.querySelector<HTMLButtonElement>(".chat-user-edit-send")!.click();
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ userText: "after", references: [] }, "c1"));
    expect(rewind).toHaveBeenCalledWith("c1", "u1");
    expect(root.querySelector(".chat-user-message-text")?.textContent).toBe("after");
  });

  it("does not let a stale initial output mode overwrite a newer change event", async () => {
    let resolveInitial!: (mode: "compact" | "detailed") => void;
    const initial = new Promise<"compact" | "detailed">((resolve) => { resolveInitial = resolve; });
    let emitMode: (mode: "compact" | "detailed") => void = () => {};
    const { root, emitAgent } = await mountWithDeps({
      getOutputMode: () => initial,
      subscribeOutputMode: (callback) => { emitMode = callback; return () => {}; },
    });
    emitAgent({ type: "session_opened", conversationId: "c1", sessionFile: conversation.sessionFile, messages: [{
      role: "assistant", timestamp: 0, blocks: [
        { type: "thinking", text: "分析" },
        { type: "tool", callId: "c1", name: "read_note", label: "读取当前文档", status: "succeeded" },
      ],
    }] });
    emitMode("detailed");
    expect(root.querySelector(".chat-process-group")).not.toBeNull();
    resolveInitial("compact");
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelector(".chat-process-group")).not.toBeNull();
  });

  it("keeps a process group interactive while streaming and after completion", async () => {
    const { root, emitAgent } = await mountWithDeps({ getOutputMode: async () => "detailed" });
    await Promise.resolve();
    emitAgent({ type: "tool", requestId: "r1", conversationId: "c1", callId: "c1", name: "read_note", label: "读取当前文档", phase: "start" });
    emitAgent({ type: "tool", requestId: "r1", conversationId: "c1", callId: "c2", name: "list_tags", label: "读取标签", phase: "start" });

    root.querySelector<HTMLButtonElement>(".chat-process-group-head")!.click();
    expect(root.querySelector<HTMLButtonElement>(".chat-process-group-head")?.getAttribute("aria-expanded")).toBe("true");

    emitAgent({ type: "tool", requestId: "r1", conversationId: "c1", callId: "c2", name: "list_tags", phase: "end" });
    emitAgent({ type: "done", requestId: "r1", conversationId: "c1" });
    expect(root.querySelector<HTMLButtonElement>(".chat-process-group-head")?.getAttribute("aria-expanded")).toBe("true");

    root.querySelector<HTMLButtonElement>(".chat-process-group-head")!.click();
    expect(root.querySelector<HTMLButtonElement>(".chat-process-group-head")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("pauses bottom following after an upward scroll and resumes from the jump button", async () => {
    const { root, emitAgent } = await mountWithDeps();
    const scroll = root.querySelector<HTMLElement>(".assistant-scroll")!;
    let scrollHeight = 1000;
    Object.defineProperties(scroll, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, get: () => scrollHeight },
    });
    scroll.scrollTop = 900;

    scroll.scrollTop = 620;
    scroll.dispatchEvent(new Event("scroll"));
    const jump = root.querySelector<HTMLButtonElement>(".assistant-scroll-bottom")!;
    expect(jump).not.toBeNull();
    expect(jump.hidden).toBe(false);

    scrollHeight = 1200;
    emitAgent({ type: "delta", requestId: "r1", conversationId: "c1", text: "partial" });
    expect(scroll.scrollTop).toBe(620);

    jump.click();
    expect(scroll.scrollTop).toBe(1200);
    expect(jump.hidden).toBe(true);

    scroll.scrollTop = 800;
    scroll.dispatchEvent(new Event("scroll"));
    expect(jump.hidden).toBe(false);
    scroll.scrollTop = 1100;
    scroll.dispatchEvent(new Event("scroll"));
    expect(jump.hidden).toBe(true);

    scrollHeight = 1300;
    emitAgent({ type: "delta", requestId: "r1", conversationId: "c1", text: " more" });
    expect(scroll.scrollTop).toBe(1300);
  });
});
