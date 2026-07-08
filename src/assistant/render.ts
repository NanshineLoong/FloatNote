import type { ChatDisplayMessage } from "../note/agent";

/**
 * 助手聊天的纯状态机：把流式 agent 事件 + 本地用户发送合并成一个消息列表。
 *
 * 渲染（DOM）与状态分离：`reduceEvents` 是纯函数，便于单测；`renderMessages`
 * 只是把状态铺成 DOM 片段。两个挂载点（独立窗 / 嵌入栏）共用同一状态机。
 */

/** 用户在输入框发送的本地事件，与 sidecar 的 AgentEvent 一起喂给 reducer。 */
export type ChatEvent =
  | { type: "ready" }
  | {
      type: "session_opened";
      conversationId: string;
      sessionFile: string;
      messages: ChatDisplayMessage[];
    }
  | { type: "delta"; requestId: string; conversationId?: string; text: string }
  | { type: "tool"; requestId: string; conversationId?: string; name: string; phase: "start" | "end" }
  | { type: "done"; requestId: string; conversationId?: string }
  | { type: "title"; conversationId: string; title: string }
  | { type: "error"; requestId: string | null; conversationId?: string; message: string }
  | { type: "user"; conversationId?: string; text: string }
  | { type: "pending"; conversationId?: string };

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; streaming: boolean; pending?: true }
  | { role: "tool"; label: string }
  | { role: "error"; text: string };

export interface ChatState {
  activeConversationId?: string;
  messages: ChatMessage[];
}

const TOOL_LABEL = "AI 正在整理笔记…";
const EMPTY_RESPONSE_MESSAGE = "助手这次没有返回内容。请检查模型名称、API Key、服务商额度或网络连接后重试。";

export function emptyChat(): ChatState {
  return { messages: [] };
}

/** 纯函数：根据一条事件返回新状态（不变更入参）。 */
export function reduceEvents(state: ChatState, event: ChatEvent): ChatState {
  switch (event.type) {
    case "ready":
      return state;

    case "session_opened":
      if (
        state.activeConversationId === event.conversationId &&
        state.messages.length > 0 &&
        event.messages.length === 0
      ) {
        return state;
      }
      return {
        activeConversationId: event.conversationId,
        messages: event.messages.map(displayMessageToChatMessage),
      };

    case "title":
      return state;

    case "user":
      if (!acceptsConversation(state, event)) return state;
      return push(state, { role: "user", text: event.text });

    case "pending":
      if (!acceptsConversation(state, event)) return state;
      return push(removePending(state), {
        role: "assistant",
        text: "正在思考…",
        streaming: true,
        pending: true,
      });

    case "delta": {
      if (!acceptsConversation(state, event)) return state;
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        const messages = state.messages.slice(0, -1);
        messages.push({
          role: "assistant",
          text: last.pending ? event.text : last.text + event.text,
          streaming: true,
        });
        return { ...state, messages };
      }
      return push(state, { role: "assistant", text: event.text, streaming: true });
    }

    case "done":
      if (!acceptsConversation(state, event)) return state;
      if (hasPending(state)) {
        return push(removePending(state), { role: "error", text: EMPTY_RESPONSE_MESSAGE });
      }
      return finalizeStreaming(state);

    case "tool":
      if (!acceptsConversation(state, event)) return state;
      if (event.phase === "start") {
        return push(removePending(state), { role: "tool", label: TOOL_LABEL });
      }
      return removeTool(state);

    case "error":
      if (!acceptsConversation(state, event)) return state;
      return push(finalizeStreaming(removePending(state)), { role: "error", text: event.message });
  }
}

function push(state: ChatState, message: ChatMessage): ChatState {
  return { ...state, messages: [...state.messages, message] };
}

/** 收尾当前正在流的 assistant 气泡（若有）。 */
function finalizeStreaming(state: ChatState): ChatState {
  const last = state.messages[state.messages.length - 1];
  if (last && last.role === "assistant" && last.streaming) {
    const messages = state.messages.slice(0, -1);
    messages.push({ ...last, streaming: false });
    return { ...state, messages };
  }
  return state;
}

/** 移除最近一条工具占位（"AI 正在整理笔记…"）。 */
function removeTool(state: ChatState): ChatState {
  const index = lastIndex(state.messages, (m) => m.role === "tool");
  if (index < 0) return state;
  const messages = state.messages.slice();
  messages.splice(index, 1);
  return { ...state, messages };
}

function removePending(state: ChatState): ChatState {
  const index = lastIndex(
    state.messages,
    (m) => m.role === "assistant" && Boolean(m.pending),
  );
  if (index < 0) return state;
  const messages = state.messages.slice();
  messages.splice(index, 1);
  return { ...state, messages };
}

function hasPending(state: ChatState): boolean {
  return state.messages.some((m) => m.role === "assistant" && Boolean(m.pending));
}

function acceptsConversation(
  state: ChatState,
  event: { conversationId?: string },
): boolean {
  if (!state.activeConversationId || !event.conversationId) return true;
  return state.activeConversationId === event.conversationId;
}

function displayMessageToChatMessage(message: ChatDisplayMessage): ChatMessage {
  switch (message.role) {
    case "user":
      return { role: "user", text: message.text };
    case "assistant":
      return { role: "assistant", text: message.text, streaming: false };
    case "tool":
      return { role: "tool", label: message.label };
    case "error":
      return { role: "error", text: message.text };
  }
}

function lastIndex<T>(items: T[], pred: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (pred(items[i])) return i;
  }
  return -1;
}

/** 把状态铺成消息列表 DOM（薄视图层；样式见 styles.css）。 */
export function renderMessages(state: ChatState): HTMLElement {
  const list = document.createElement("div");
  list.className = "chat-messages";
  for (const message of state.messages) {
    list.appendChild(renderMessage(message));
  }
  return list;
}

function renderMessage(message: ChatMessage): HTMLElement {
  const el = document.createElement("div");
  el.className = `chat-msg chat-${message.role}`;
  if (message.role === "tool") {
    el.textContent = message.label;
    el.classList.add("chat-tool-pending");
  } else {
    el.textContent = message.text;
    if (message.role === "assistant" && message.streaming) {
      el.classList.add("chat-streaming");
    }
    if (message.role === "assistant" && message.pending) {
      el.classList.add("chat-pending");
    }
  }
  return el;
}
