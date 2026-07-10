import type { ChatDisplayMessage } from "../../note/agent";
import { type EditPreviewDetail, type WriteMode } from "../permission-bubble";

/**
 * 助手聊天的纯状态机：把流式 agent 事件 + 本地用户发送合并成一个块序列。
 *
 * 心智模型对标 Claude.ai / ChatGPT：一条 assistant 消息 = 一串平级块
 * （text / thinking / action / error），块互不嵌套。渲染与状态分离：
 * `reduceEvents` 是纯函数，便于单测；DOM 投影由 `blocks.ts` 增量复用。
 *
 * 闪烁修复的关键：状态层产出稳定的 message/block id，渲染层据此复用节点
 * 而非全量重建（见 `blocks.ts`）。
 */

/** 用户在输入框发送的本地事件 + 前端派生的 permission 事件，与 sidecar 的 AgentEvent 一起喂给 reducer。 */
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
  | { type: "pending"; conversationId?: string }
  // thinking 块事件（sidecar 新转发）。
  | { type: "thinking_start"; requestId: string; conversationId?: string; blockId: string }
  | { type: "thinking_delta"; requestId: string; conversationId?: string; text: string }
  | { type: "thinking_end"; requestId: string; conversationId?: string }
  // 流内动作卡：复用 Rust permission://request 流填充 detail，resolve 驱动状态。
  | {
      type: "permission_request";
      requestId: string; // Rust pending-edit id，resolve 幂等键
      conversationId?: string;
      toolName: string;
      detail: EditPreviewDetail;
      summary: string;
      oldContent: string;
      newContent: string;
      canSnapshot: boolean;
    }
  | { type: "permission_resolve"; requestId: string; decision: "allow" | "deny" }
  // thinking 折叠切换（仅内存，不落库）。
  | { type: "thinking_toggle"; blockId: string };

export type Block =
  | { id: string; kind: "text"; text: string; streaming?: boolean }
  | { id: string; kind: "thinking"; text: string; collapsed: boolean; done: boolean }
  | {
      id: string;
      kind: "action";
      tool: string;
      detail?: EditPreviewDetail;
      summary?: string;
      oldContent?: string;
      newContent?: string;
      canSnapshot?: boolean;
      status: "pending" | "approved" | "rejected" | "done";
      writeMode?: WriteMode;
      requestId?: string; // Rust pending-edit id；填充后即可交互/作为 resolve 幂等键
    }
  | { id: string; kind: "error"; text: string };

export type ChatMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; blocks: Block[]; streaming: boolean; pending?: true };

export interface ChatState {
  activeConversationId?: string;
  messages: ChatMessage[];
}

const EMPTY_RESPONSE_MESSAGE = "助手这次没有返回内容。请检查模型名称、API Key、服务商额度或网络连接后重试。";

// 稳定 id 生成：消息/块节点复用的键。用递增计数器（运行时单例足够）；
// 测试通过 stripIds 归一化比较，不依赖具体值。
let idSeq = 0;
function nextId(prefix: string): string {
  return `${prefix}${++idSeq}`;
}

export function emptyChat(): ChatState {
  return { messages: [] };
}

/** 当前是否正在流式输出（存在 streaming 的 assistant 消息）。 */
export function isChatStreaming(state: ChatState): boolean {
  return state.messages.some((m) => m.role === "assistant" && m.streaming);
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
        messages: event.messages
          .map(displayMessageToChatMessage)
          .filter((m): m is ChatMessage => m !== null),
      };

    case "title":
      return state;

    case "user":
      if (!acceptsConversation(state, event)) return state;
      return push(state, { id: nextId("m"), role: "user", text: event.text });

    case "pending":
      if (!acceptsConversation(state, event)) return state;
      return push(removePending(state), {
        id: nextId("m"),
        role: "assistant",
        blocks: [{ id: nextId("b"), kind: "text", text: "正在思考…", streaming: true }],
        streaming: true,
        pending: true,
      });

    case "delta": {
      if (!acceptsConversation(state, event)) return state;
      const last = state.messages[state.messages.length - 1];
      if (last && last.role === "assistant" && last.streaming) {
        if (last.pending) {
          // 首个真实 token：替换占位文本块，清除 pending。
          return updateLast(state, {
            ...last,
            pending: undefined,
            blocks: [{ id: nextId("b"), kind: "text", text: event.text, streaming: true }],
          });
        }
        const blocks = last.blocks.slice();
        const lb = blocks[blocks.length - 1];
        if (lb && lb.kind === "text") {
          blocks[blocks.length - 1] = { ...lb, text: lb.text + event.text, streaming: true };
        } else {
          blocks.push({ id: nextId("b"), kind: "text", text: event.text, streaming: true });
        }
        return updateLast(state, { ...last, blocks });
      }
      return push(state, {
        id: nextId("m"),
        role: "assistant",
        blocks: [{ id: nextId("b"), kind: "text", text: event.text, streaming: true }],
        streaming: true,
      });
    }

    case "thinking_start": {
      if (!acceptsConversation(state, event)) return state;
      const { state: s, msg } = ensureStreaming(state);
      return updateLast(s, {
        ...msg,
        blocks: [...msg.blocks, { id: event.blockId, kind: "thinking", text: "", collapsed: true, done: false }],
      });
    }

    case "thinking_delta": {
      if (!acceptsConversation(state, event)) return state;
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== "assistant" || !last.streaming) return state;
      const blocks = last.blocks.slice();
      const lb = blocks[blocks.length - 1];
      if (lb && lb.kind === "thinking" && !lb.done) {
        blocks[blocks.length - 1] = { ...lb, text: lb.text + event.text };
      } else {
        blocks.push({ id: nextId("b"), kind: "thinking", text: event.text, collapsed: true, done: false });
      }
      return updateLast(state, { ...last, blocks });
    }

    case "thinking_end": {
      if (!acceptsConversation(state, event)) return state;
      const last = state.messages[state.messages.length - 1];
      if (!last || last.role !== "assistant") return state;
      const blocks = last.blocks.slice();
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].kind === "thinking") {
          blocks[i] = { ...(blocks[i] as Extract<Block, { kind: "thinking" }>), done: true };
          break;
        }
      }
      return updateLast(state, { ...last, blocks });
    }

    case "done": {
      if (!acceptsConversation(state, event)) return state;
      if (hasPending(state)) {
        // 占位仍在 = 无任何真实输出 → 空响应错误。
        return push(removePending(state), {
          id: nextId("m"),
          role: "assistant",
          blocks: [{ id: nextId("b"), kind: "error", text: EMPTY_RESPONSE_MESSAGE }],
          streaming: false,
        });
      }
      return finalizeStreaming(state);
    }

    case "tool": {
      if (!acceptsConversation(state, event)) return state;
      if (event.phase === "start") {
        // 所有工具都产出流内块：写入/标签工具走完整 action 卡（detail 由
        // permission://request 填充），只读工具（read_note/list_tags/read_skill）
        // 走紧凑行（无 detail/requestId → action-card 渲染 header-only）。
        const { state: s, msg } = ensureStreaming(state);
        return updateLast(s, {
          ...msg,
          blocks: [...msg.blocks, { id: nextId("b"), kind: "action", tool: event.name, status: "pending" }],
        });
      }
      // phase end：把最近一个 pending/approved 的 action 置 done（rejected 保留）。
      return setLastActionStatus(state, (st) => st === "pending" || st === "approved", "done");
    }

    case "error": {
      if (!acceptsConversation(state, event)) return state;
      const cleaned = finalizeStreaming(removePending(state));
      const last = cleaned.messages[cleaned.messages.length - 1];
      // 有内容的 assistant 消息：错误作为兄弟块追加；否则单开一条错误消息。
      if (last && last.role === "assistant" && last.blocks.length > 0 && !last.streaming) {
        return updateLast(cleaned, {
          ...last,
          blocks: [...last.blocks, { id: nextId("b"), kind: "error", text: event.message }],
        });
      }
      return push(cleaned, {
        id: nextId("m"),
        role: "assistant",
        blocks: [{ id: nextId("b"), kind: "error", text: event.message }],
        streaming: false,
      });
    }

    case "permission_request": {
      if (!acceptsConversation(state, event)) return state;
      return fillActionBlock(state, event);
    }

    case "permission_resolve": {
      return setLastActionStatus(
        state,
        (st) => st === "pending" || st === "approved" || st === "rejected",
        event.decision === "allow" ? "approved" : "rejected",
        (b) => b.requestId === event.requestId,
      );
    }

    case "thinking_toggle": {
      // 翻转指定 thinking 块的 collapsed（在任意 assistant 消息中查找）。
      const messages = state.messages.map((m) => {
        if (m.role !== "assistant") return m;
        let touched = false;
        const blocks = m.blocks.map((b) => {
          if (b.kind === "thinking" && b.id === event.blockId) {
            touched = true;
            return { ...b, collapsed: !b.collapsed };
          }
          return b;
        });
        return touched ? { ...m, blocks } : m;
      });
      return { ...state, messages };
    }
  }
}

function push(state: ChatState, message: ChatMessage): ChatState {
  return { ...state, messages: [...state.messages, message] };
}

/** 替换末位消息（不变更入参）。 */
function updateLast(state: ChatState, message: ChatMessage): ChatState {
  const messages = state.messages.slice(0, -1);
  messages.push(message);
  return { ...state, messages };
}

/** 取得当前流式 assistant 消息；若无（或仅占位）则移除占位并新建一条空流式消息。 */
function ensureStreaming(state: ChatState): { state: ChatState; msg: Extract<ChatMessage, { role: "assistant" }> } {
  const last = state.messages[state.messages.length - 1];
  if (last && last.role === "assistant" && last.streaming && !last.pending) {
    return { state, msg: last };
  }
  const cleaned = removePending(state);
  const msg: Extract<ChatMessage, { role: "assistant" }> = { id: nextId("m"), role: "assistant", blocks: [], streaming: true };
  return { state: push(cleaned, msg), msg };
}

/** 收尾当前正在流的 assistant 消息（若有）。 */
function finalizeStreaming(state: ChatState): ChatState {
  const last = state.messages[state.messages.length - 1];
  if (last && last.role === "assistant" && last.streaming) {
    const blocks = last.blocks.map((b) =>
      b.kind === "text" ? { ...b, streaming: false } : b,
    );
    return updateLast(state, { ...last, blocks, streaming: false });
  }
  return state;
}

function removePending(state: ChatState): ChatState {
  const index = lastIndex(state.messages, (m) => m.role === "assistant" && Boolean(m.pending));
  if (index < 0) return state;
  const messages = state.messages.slice();
  messages.splice(index, 1);
  return { ...state, messages };
}

function hasPending(state: ChatState): boolean {
  return state.messages.some((m) => m.role === "assistant" && Boolean(m.pending));
}

/**
 * 填充最近一个同 tool 的 pending action block（detail/old/new/canSnapshot/requestId）。
 * 匹配规则：从末位 assistant 消息倒序找首个 `kind==="action" && status==="pending" && tool===toolName && requestId==null`。
 * 找不到则忽略（dock 固定弹窗作为兜底会处理）。
 */
function fillActionBlock(state: ChatState, event: Extract<ChatEvent, { type: "permission_request" }>): ChatState {
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== "assistant") return state;
  const blocks = last.blocks.slice();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (
      b.kind === "action" &&
      b.status === "pending" &&
      b.requestId === undefined &&
      b.tool === event.toolName
    ) {
      blocks[i] = {
        ...b,
        detail: event.detail,
        summary: event.summary,
        oldContent: event.oldContent,
        newContent: event.newContent,
        canSnapshot: event.canSnapshot,
        requestId: event.requestId,
      };
      return updateLast(state, { ...last, blocks });
    }
  }
  return state;
}

/**
 * 修改最后一个满足 `pred(status)`（且可选 `where`）的 action block 的 status。
 * 用于 tool_end（→ done）与 permission_resolve（→ approved/rejected）。
 */
function setLastActionStatus(
  state: ChatState,
  pred: (status: string) => boolean,
  status: "pending" | "approved" | "rejected" | "done",
  where?: (b: Extract<Block, { kind: "action" }>) => boolean,
): ChatState {
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== "assistant") return state;
  const blocks = last.blocks.slice();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.kind === "action" && pred(b.status) && (!where || where(b))) {
      blocks[i] = { ...b, status };
      return updateLast(state, { ...last, blocks });
    }
  }
  return state;
}

function acceptsConversation(state: ChatState, event: { conversationId?: string }): boolean {
  if (!state.activeConversationId || !event.conversationId) return true;
  return state.activeConversationId === event.conversationId;
}

function displayMessageToChatMessage(message: ChatDisplayMessage): ChatMessage | null {
  switch (message.role) {
    case "user":
      return { id: nextId("m"), role: "user", text: message.text };
    case "assistant":
      return {
        id: nextId("m"),
        role: "assistant",
        blocks: [{ id: nextId("b"), kind: "text", text: message.text, streaming: false }],
        streaming: false,
      };
    case "error":
      return {
        id: nextId("m"),
        role: "assistant",
        blocks: [{ id: nextId("b"), kind: "error", text: message.text }],
        streaming: false,
      };
    case "tool":
      // 历史工具条目无结构化 detail，丢弃（实时工具走 action block 流）。
      return null;
  }
}

function lastIndex<T>(items: T[], pred: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (pred(items[i])) return i;
  }
  return -1;
}
