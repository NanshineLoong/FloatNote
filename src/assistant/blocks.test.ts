// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { afterEach } from "vitest";
import { emptyChat, reduceEvents, type ChatState } from "./render";
import { reconcileMessages, __resetBlockMap } from "./blocks";

function makeScroll(): HTMLElement {
  const el = document.createElement("div");
  el.className = "assistant-scroll";
  Object.defineProperty(el, "clientHeight", { value: 100, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: 100, configurable: true });
  return el;
}

function run(events: Parameters<typeof reduceEvents>[1][]): ChatState {
  return events.reduce(reduceEvents, emptyChat());
}

describe("reconcileMessages", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("reuses an existing message node across deltas (no rebuild)", () => {
    const scroll = makeScroll();
    const map = new Map<string, HTMLElement>();
    const s1 = run([{ type: "delta", requestId: "r1", text: "Hel" }]);
    reconcileMessages(scroll, s1.messages, map);
    const msgEl = scroll.querySelector<HTMLElement>(".chat-msg")!;
    expect(msgEl).toBeTruthy();
    // 给节点打标记，验证后续 delta 不重建节点。
    msgEl.dataset.marker = "kept";

    const s2 = reduceEvents(s1, { type: "delta", requestId: "r1", text: "lo" });
    reconcileMessages(scroll, s2.messages, map);
    const after = scroll.querySelector<HTMLElement>(".chat-msg")!;
    expect(after.dataset.marker).toBe("kept");
  });

  it("reuses a text block node and updates content without rebuilding", () => {
    const scroll = makeScroll();
    const map = new Map<string, HTMLElement>();
    const s1 = run([{ type: "delta", requestId: "r1", text: "Hel" }]);
    reconcileMessages(scroll, s1.messages, map);
    const block = scroll.querySelector<HTMLElement>(".chat-block-text")!;
    block.dataset.marker = "kept";

    const s2 = reduceEvents(s1, { type: "delta", requestId: "r1", text: "lo" });
    reconcileMessages(scroll, s2.messages, map);
    const after = scroll.querySelector<HTMLElement>(".chat-block-text")!;
    expect(after.dataset.marker).toBe("kept");
    expect(after.querySelector(".chat-text-content")?.textContent).toContain("Hello");
  });

  it("appends a new thinking block as a sibling without dropping the text block", () => {
    const scroll = makeScroll();
    const map = new Map<string, HTMLElement>();
    const s1 = run([{ type: "delta", requestId: "r1", text: "答案" }]);
    reconcileMessages(scroll, s1.messages, map);

    const s2 = reduceEvents(s1, { type: "thinking_start", requestId: "r1", blockId: "t1" });
    reconcileMessages(scroll, s2.messages, map);
    const blocks = scroll.querySelectorAll<HTMLElement>(".chat-block");
    expect(blocks.length).toBe(2);
    expect(blocks[0].classList.contains("chat-block-text")).toBe(true);
    expect(blocks[1].classList.contains("chat-block-thinking")).toBe(true);
  });

  it("removes stale messages on session switch", () => {
    const scroll = makeScroll();
    const map = new Map<string, HTMLElement>();
    const s1 = run([{ type: "user", text: "旧" }]);
    reconcileMessages(scroll, s1.messages, map);
    expect(scroll.querySelectorAll(".chat-msg").length).toBe(1);

    const s2 = run([{ type: "user", text: "新" }]);
    reconcileMessages(scroll, s2.messages, map);
    expect(scroll.querySelectorAll(".chat-msg").length).toBe(1);
    expect(scroll.querySelector(".chat-msg")?.textContent).toContain("新");
  });

  it("marks the assistant message node with data-message-id", () => {
    const scroll = makeScroll();
    const map = new Map<string, HTMLElement>();
    const s = run([{ type: "delta", requestId: "r1", text: "x" }]);
    reconcileMessages(scroll, s.messages, map);
    const el = scroll.querySelector<HTMLElement>(".chat-msg.chat-assistant")!;
    expect(el.dataset.messageId).toBeTruthy();
    __resetBlockMap(el);
  });

  it("copies the latest streamed text rather than the initial render value", async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => { writes.push(text); } },
    });
    const scroll = makeScroll();
    const map = new Map<string, HTMLElement>();
    const s1 = run([{ type: "delta", requestId: "r1", text: "Hel" }]);
    reconcileMessages(scroll, s1.messages, map);
    const s2 = reduceEvents(s1, { type: "delta", requestId: "r1", text: "lo" });
    reconcileMessages(scroll, s2.messages, map);
    scroll.querySelector<HTMLButtonElement>(".chat-copy-btn")!.click();
    await Promise.resolve();
    expect(writes).toEqual(["Hello"]);
  });

  it("renders copy and retry as icon-only actions with accessible labels", () => {
    const scroll = makeScroll();
    const map = new Map<string, HTMLElement>();
    const state = run([{ type: "delta", requestId: "r1", text: "answer" }, { type: "done", requestId: "r1" }]);
    reconcileMessages(scroll, state.messages, map);
    const buttons = Array.from(scroll.querySelectorAll<HTMLButtonElement>(".chat-message-action"));
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["复制原文", "重试"]);
    expect(buttons.every((button) => button.textContent === "")).toBe(true);
  });

  it("renders structured references as chips in a user bubble", () => {
    const scroll = makeScroll();
    const map = new Map<string, HTMLElement>();
    const state = run([{
      type: "user",
      text: "整理它",
      references: [
        { kind: "file", id: "piece.md", display: "piece.md" },
        { kind: "skill", id: "summarize", display: "summarize" },
      ],
    }]);
    reconcileMessages(scroll, state.messages, map);
    expect(scroll.querySelector(".chat-reference-chip.file")?.textContent).toContain("piece.md");
    expect(scroll.querySelector(".chat-reference-chip.skill")?.textContent).toContain("Skill · summarize");
  });
});
