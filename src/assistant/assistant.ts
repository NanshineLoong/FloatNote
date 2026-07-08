import type { UnlistenFn } from "@tauri-apps/api/event";
import type { AgentEvent } from "../note/agent";
import type { ChatConversation, ChatScope } from "../note/chat-history";
import { deriveTitleFromFirstMessage, formatHistoryTime } from "../note/chat-history-format";
import socratesSvg from "../assets/socrates.svg?raw";
import {
  type ChatEvent,
  type ChatState,
  emptyChat,
  reduceEvents,
  renderMessages,
} from "./render";

/**
 * 与挂载点无关的助手组件。挂在笔记窗内的 `#assistant-region`，inline/floating 共用同一份。
 *
 * 依赖经 `deps` 注入（发送 / 订阅），故组件本身不直接依赖 Tauri，便于测试与复用。
 * 状态用 render.ts 的纯 reducer 维护；DOM 只是状态的薄投影。
 */
export interface AssistantDeps {
  /** 发送一条用户消息给 tutor。 */
  send: (text: string, conversationId: string) => unknown;
  createConversation: (scope: ChatScope) => Promise<ChatConversation>;
  openConversation: (conversation: ChatConversation) => Promise<ChatConversation | null | void>;
  listConversations: (scope: ChatScope) => Promise<ChatConversation[]>;
  getLastConversation: (scope: ChatScope) => Promise<ChatConversation | null>;
  updateTitle: (
    conversationId: string,
    title: string,
    titleState: ChatConversation["titleState"],
  ) => Promise<ChatConversation | null>;
  /** 订阅 agent 流式事件；返回取消订阅句柄（同步或 Promise）。 */
  subscribe: (cb: (event: AgentEvent) => void) => UnlistenFn | Promise<UnlistenFn>;
}

export interface AssistantHandle {
  destroy: () => void;
  setScope: (scope: ChatScope | null) => void;
  openConversation: (conversation: ChatConversation) => Promise<void>;
  /** 外部注入一条错误消息（如 sidecar 启动失败），显示在聊天区域。 */
  showError: (message: string) => void;
}

export function mountAssistant(root: HTMLElement, deps: AssistantDeps): AssistantHandle {
  let state: ChatState = emptyChat();

  root.classList.add("assistant");
  root.innerHTML = `
    <div class="assistant-card">
      <button class="assistant-new" type="button" aria-label="新对话" title="新对话"><i class="ph ph-plus"></i></button>
      <div class="assistant-scroll"></div>
    </div>
    <div class="assistant-dock">
      <button class="assistant-bot" type="button" aria-label="展开输入框">${socratesSvg}</button>
      <div class="assistant-history-popover" hidden></div>
      <div class="assistant-input-wrap">
        <textarea class="assistant-input" rows="1" placeholder="和助手说点什么…"></textarea>
        <button class="assistant-send" type="button" aria-label="查看项目对话历史" title="查看项目对话历史"><i class="ph ph-clock-counter-clockwise"></i></button>
      </div>
    </div>
  `;

  const scroll = root.querySelector<HTMLElement>(".assistant-scroll")!;
  const newBtn = root.querySelector<HTMLButtonElement>(".assistant-new")!;
  const bot = root.querySelector<HTMLButtonElement>(".assistant-bot")!;
  const inputWrap = root.querySelector<HTMLElement>(".assistant-input-wrap")!;
  const input = root.querySelector<HTMLTextAreaElement>(".assistant-input")!;
  const sendBtn = root.querySelector<HTMLButtonElement>(".assistant-send")!;
  const historyPopover = root.querySelector<HTMLElement>(".assistant-history-popover")!;
  let currentScope: ChatScope | null = null;
  let activeConversation: ChatConversation | null = null;
  let scopeToken = 0;

  function rerender() {
    // 新对话按钮在 .assistant-card 内、滚动容器之外，锚定卡片右上角，不随消息滚动。
    scroll.replaceChildren(renderMessages(state));
    scroll.scrollTop = scroll.scrollHeight;
    // 无消息时不渲染聊天历史容器，避免 floating 态出现空的卡片/气泡（inline 态无副作用）。
    root.classList.toggle("has-messages", state.messages.length > 0);
  }

  function dispatch(event: ChatEvent) {
    state = reduceEvents(state, event);
    rerender();
  }

  function setActiveConversation(conversation: ChatConversation | null, clearMessages = false) {
    activeConversation = conversation;
    root.dataset.conversationId = conversation?.id ?? "";
    if (!conversation) return;
    state = clearMessages
      ? { activeConversationId: conversation.id, messages: [] }
      : { ...state, activeConversationId: conversation.id };
    if (clearMessages) rerender();
  }

  async function updateConversationTitle(conversation: ChatConversation, text: string) {
    if (conversation.titleState !== "temporary" || conversation.title !== "新对话") return;
    const derived = deriveTitleFromFirstMessage(text);
    try {
      const updated = await deps.updateTitle(conversation.id, derived.title, derived.titleState);
      activeConversation = updated ?? { ...conversation, ...derived };
    } catch {
      activeConversation = { ...conversation, ...derived };
    }
  }

  let inputOpen = false;
  function setInputOpen(open: boolean) {
    inputOpen = open;
    inputWrap.classList.toggle("open", open);
    // floating 态下，展开/收起整块浮层（聊天历史卡片）由这个类驱动；inline 态无副作用。
    root.classList.toggle("expanded", open);
    // 机器人轻微缩放「应答」，动画结束自动复位。
    bot.classList.remove("nudge");
    void bot.offsetWidth; // 强制重排以重启动画
    bot.classList.add("nudge");
    if (open) setTimeout(() => input.focus(), 160);
    else input.blur();
    if (!open) closeHistoryPopover();
  }

  bot.addEventListener("click", () => setInputOpen(!inputOpen));

  function autosize() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
    updateSendMode();
  }

  function updateSendMode() {
    const hasText = input.value.trim().length > 0;
    sendBtn.setAttribute("aria-label", hasText ? "发送" : "查看项目对话历史");
    sendBtn.title = hasText ? "发送" : "查看项目对话历史";
    sendBtn.innerHTML = hasText
      ? `<i class="ph ph-arrow-up"></i>`
      : `<i class="ph ph-clock-counter-clockwise"></i>`;
  }

  async function submit() {
    const text = input.value.trim();
    if (!text) {
      await toggleHistoryPopover();
      return;
    }
    const scope = currentScope;
    if (!scope) {
      dispatch({ type: "error", requestId: null, message: "当前没有打开的项目或文档，请稍后再试" });
      return;
    }
    let conversation = activeConversation;
    if (!conversation) {
      conversation = await deps.createConversation(scope);
      setActiveConversation(conversation);
    }
    await updateConversationTitle(conversation, text);
    state = { ...state, activeConversationId: conversation.id };
    input.value = "";
    autosize();
    dispatch({ type: "user", conversationId: conversation.id, text });
    dispatch({ type: "pending", conversationId: conversation.id });
    try {
      await deps.send(text, conversation.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch({ type: "error", requestId: null, conversationId: conversation.id, message });
    }
  }

  async function startNewConversation() {
    const scope = currentScope;
    if (!scope) return;
    closeHistoryPopover();
    try {
      const conversation = await deps.createConversation(scope);
      setActiveConversation(conversation, true);
      setInputOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch({ type: "error", requestId: null, message });
    }
  }

  async function toggleHistoryPopover() {
    if (!historyPopover.hidden) {
      closeHistoryPopover();
      return;
    }
    const scope = currentScope;
    if (!scope) return;
    historyPopover.hidden = false;
    historyPopover.textContent = "载入中…";
    try {
      renderHistory(await deps.listConversations(scope), scope);
    } catch (err) {
      historyPopover.textContent = err instanceof Error ? err.message : String(err);
    }
  }

  function closeHistoryPopover() {
    historyPopover.hidden = true;
    historyPopover.replaceChildren();
  }

  function renderHistory(conversations: ChatConversation[], scope: ChatScope) {
    void scope;
    historyPopover.replaceChildren();
    if (conversations.length === 0) {
      const empty = document.createElement("div");
      empty.className = "assistant-history-empty";
      empty.textContent = "当前范围还没有对话";
      historyPopover.appendChild(empty);
      return;
    }
    for (const conversation of conversations) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "assistant-history-item";
      const title = document.createElement("span");
      title.className = "assistant-history-title";
      title.textContent = conversation.title;
      const meta = document.createElement("span");
      meta.className = "assistant-history-meta";
      meta.textContent = formatHistoryTime(conversation.updatedAt);
      item.append(title, meta);
      item.addEventListener("click", () => {
        void openConversation(conversation);
      });
      historyPopover.appendChild(item);
    }
  }

  async function openConversation(conversation: ChatConversation) {
    scopeToken += 1;
    closeHistoryPopover();
    setActiveConversation(conversation, true);
    setInputOpen(true);
    try {
      await deps.openConversation(conversation);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch({ type: "error", requestId: null, conversationId: conversation.id, message });
    }
  }

  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  });
  sendBtn.addEventListener("click", () => { void submit(); });
  newBtn.addEventListener("click", () => { void startNewConversation(); });

  function onDocumentPointerDown(e: PointerEvent) {
    if (historyPopover.hidden) return;
    const target = e.target;
    if (target instanceof Node && root.contains(target)) return;
    closeHistoryPopover();
  }

  function onDocumentKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") closeHistoryPopover();
  }

  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeyDown);

  rerender();
  updateSendMode();

  let unlisten: UnlistenFn | null = null;
  let destroyed = false;
  Promise.resolve(deps.subscribe((event) => {
    if (event.type === "session_opened") {
      state = reduceEvents(state, event);
      rerender();
      return;
    }
    if (event.type === "title" && activeConversation?.id === event.conversationId) {
      activeConversation = { ...activeConversation, title: event.title, titleState: "final" };
    }
    dispatch(event);
  })).then((un) => {
    if (destroyed) un();
    else unlisten = un;
  });

  return {
    destroy() {
      destroyed = true;
      unlisten?.();
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("keydown", onDocumentKeyDown);
      root.classList.remove("assistant");
      root.innerHTML = "";
    },
    setScope(scope: ChatScope | null) {
      currentScope = scope;
      setActiveConversation(null);
      closeHistoryPopover();
      state = emptyChat();
      rerender();
      const token = ++scopeToken;
      if (!scope) return;
      void deps.getLastConversation(scope)
        .then(async (conversation) => {
          if (token !== scopeToken) return;
          if (!conversation) return;
          setActiveConversation(conversation);
          await deps.openConversation(conversation);
        })
        .catch((err) => {
          if (token !== scopeToken) return;
          const message = err instanceof Error ? err.message : String(err);
          dispatch({ type: "error", requestId: null, message });
        });
    },
    openConversation,
    showError(message: string) {
      dispatch({ type: "error", requestId: null, message });
    },
  };
}
