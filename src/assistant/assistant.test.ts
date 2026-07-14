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
});
