import type { UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentEvent } from "../platform/agent";
import type { ChatConversation, ChatScope } from "../platform/chat-history";
import { deriveTitleFromFirstMessage, formatHistoryTime } from "../platform/chat-history-format";
import socratesSvg from "../assets/socrates.svg?raw";
import { mountPermissionBubble, type PermissionRequest } from "./permission-bubble.js";
import { mountSkillPicker, type SkillSummary } from "./skill-picker.js";
import { mountMentionPicker, type MentionFile } from "./mention-picker.js";
import {
  type ChatEvent,
  type ChatState,
  emptyChat,
  isChatStreaming,
  reduceEvents,
} from "./render";
import { reconcileMessages } from "./blocks";

/**
 * 与挂载点无关的助手组件。挂在笔记窗内的 `#assistant-region`，inline/floating 共用同一份。
 *
 * 依赖经 `deps` 注入（发送 / 订阅），故组件本身不直接依赖 Tauri，便于测试与复用。
 * 状态用 render.ts 的纯 reducer 维护；DOM 只是状态的薄投影。
 */
export interface AssistantDeps {
  /** 发送一条用户消息给 tutor，返回 requestId（用于取消）。 */
  send: (text: string, conversationId: string) => Promise<string>;
  createConversation: (scope: ChatScope) => Promise<ChatConversation>;
  openConversation: (conversation: ChatConversation) => Promise<ChatConversation | null | void>;
  listConversations: (scope: ChatScope) => Promise<ChatConversation[]>;
  getLastConversation: (scope: ChatScope) => Promise<ChatConversation | null>;
  updateTitle: (
    conversationId: string,
    title: string,
    titleState: ChatConversation["titleState"],
  ) => Promise<ChatConversation | null>;
  /** 订阅 agent 流式事件；返回取消订阅句柄。 */
  subscribe: (cb: (event: AgentEvent) => void) => UnlistenFn | Promise<UnlistenFn>;
  /** 取消进行中的请求（经 stdin 发 Cancel）。无活动请求时 no-op。 */
  cancel?: (requestId: string) => void;
  /** 拉取已加载 skill 列表（供 picker 右键菜单与 `/` 自动补全）。 */
  listSkills: () => Promise<SkillSummary[]>;
  /** 拉取当前作用域内全部文件（供 `@` 文件提及）：project 模式为项目内全部 .md，
   *  document 模式为当前文档。 */
  listFiles: (scope: ChatScope) => Promise<MentionFile[]>;
}

export interface AssistantHandle {
  destroy: () => void;
  setScope: (scope: ChatScope | null) => void;
  openConversation: (conversation: ChatConversation) => Promise<void>;
  showError: (message: string) => void;
  /** 展开/收起输入气泡。 */
  setInputOpen: (open: boolean) => void;
  /** 输入气泡是否展开。 */
  isInputOpen: () => boolean;
  /** AI 是否正在流式输出。 */
  isStreaming: () => boolean;
  /** 取消进行中的 AI 回复（焦点在助手区且流式时由 Esc 调用）。 */
  cancel: () => void;
  /** 开始新对话（连带展开气泡）。 */
  startNewConversation: () => void;
  /** 历史浮层是否打开。 */
  isHistoryPopoverOpen: () => boolean;
  /** 关闭历史浮层。 */
  closeHistoryPopover: () => void;
  /** 权限气泡是否打开（等待用户允许/拒绝）。 */
  isPermissionBubbleOpen: () => boolean;
  /** 拒绝当前权限请求并关闭气泡（Esc 最高优先级）。 */
  closePermissionBubble: () => void;
  /** skill 菜单/下拉是否打开（右键小人或输入框 `/` 触发）。 */
  isSkillMenuOpen: () => boolean;
  /** 关闭 skill 菜单/下拉（Esc 链中优先于历史浮层）。 */
  closeSkillMenu: () => void;
  /** `@` 文件提及下拉是否打开。 */
  isMentionMenuOpen: () => boolean;
  /** 关闭 `@` 文件提及下拉（Esc 链中置于 skill 菜单之后、历史浮层之前）。 */
  closeMentionMenu: () => void;
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
      <div class="assistant-perm-region"></div>
      <div class="assistant-input-wrap">
        <textarea class="assistant-input" rows="1" placeholder="说点什么…"></textarea>
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
  const permRegion = root.querySelector<HTMLElement>(".assistant-perm-region")!;
  let currentScope: ChatScope | null = null;
  let activeConversation: ChatConversation | null = null;
  let scopeToken = 0;
  // 消息节点复用表（增量渲染，消灭闪烁）。会话切换时由 reconcile 的 stale 清理自动清空。
  const msgMap = new Map<string, HTMLElement>();

  function rerender() {
    // 定向增量更新：已完成消息/块节点复用，不重放进场动画 → 消灭闪烁。
    reconcileMessages(scroll, state.messages, msgMap);
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
  let activeRequestId: string | null = null;
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
      activeRequestId = await deps.send(text, conversation.id);
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

  document.addEventListener("pointerdown", onDocumentPointerDown);

  rerender();
  updateSendMode();

  let destroyed = false;
  let unlisten: UnlistenFn | null = null;

  const permBubble = mountPermissionBubble(permRegion, (req, decision, writeMode) => {
    resolvePermission(req.request_id, decision, writeMode);
  });
  // mention 下拉需在 skillPicker 之后创建（closeSkill 引用 skillPicker），故用前置占位
  // 让 skillPicker 的 closeMention 能引用到尚未创建的 mentionPicker。
  let closeMentionMenuFn: () => void = () => {};
  const skillPicker = mountSkillPicker({
    bot,
    input,
    inputWrap,
    listSkills: deps.listSkills,
    openInput: () => setInputOpen(true),
    closeMention: () => closeMentionMenuFn(),
  });
  const mentionPicker = mountMentionPicker({
    input,
    dock: inputWrap.parentElement!,
    listFiles: deps.listFiles,
    getScope: () => currentScope,
    closeSkill: () => skillPicker.close(),
  });
  closeMentionMenuFn = () => mentionPicker.close();

  /** 统一的 permission resolve 入口：派发 reducer 状态 + 调 Rust + 清 dock 兜底气泡。
   *  流内 action 卡与 dock 兜底气泡共用，以 requestId 为幂等键。 */
  function resolvePermission(
    requestId: string,
    decision: "allow" | "deny",
    writeMode: "direct" | "snapshot",
  ) {
    dispatch({ type: "permission_resolve", requestId, decision });
    void invoke("resolve_permission", { requestId, decision, writeMode });
    permBubble.clear();
  }

  // 流内 action 卡的允许/拒绝按钮派发 chat:resolve（bubbles），在此统一处理。
  scroll.addEventListener("chat:resolve", (e) => {
    const detail = (e as CustomEvent).detail as {
      requestId: string;
      decision: "allow" | "deny";
      writeMode: "direct" | "snapshot";
    };
    resolvePermission(detail.requestId, detail.decision, detail.writeMode);
  });

  // thinking 块折叠/展开切换。
  scroll.addEventListener("chat:toggle-thinking", (e) => {
    const detail = (e as CustomEvent).detail as { blockId: string };
    dispatch({ type: "thinking_toggle", blockId: detail.blockId });
  });

  // permission://request：优先填充流内 action 卡；若无匹配卡（非流式即时请求），
  // 回退到 dock 固定气泡。
  let permUnlisten: UnlistenFn | null = null;
  listen<PermissionRequest>("permission://request", (e) => {
    const req = e.payload;
    dispatch({
      type: "permission_request",
      requestId: req.request_id,
      conversationId: req.conversation_id,
      toolName: req.tool_name,
      detail: req.preview.detail,
      summary: req.preview.summary,
      oldContent: req.old_content,
      newContent: req.new_content,
      canSnapshot: req.can_snapshot,
    });
    // 若 reducer 填充了对应 action 块（requestId 匹配），由流内卡处理；否则 dock 兜底。
    const handled = state.messages.some(
      (m) =>
        m.role === "assistant" &&
        m.blocks.some((b) => b.kind === "action" && b.requestId === req.request_id),
    );
    if (!handled) permBubble.show(req);
  }).then((un) => {
    if (destroyed) un();
    else permUnlisten = un;
  });

  Promise.resolve(deps.subscribe((event) => {
    if (event.type === "session_opened") {
      state = reduceEvents(state, event);
      rerender();
      return;
    }
    if (event.type === "title" && activeConversation?.id === event.conversationId) {
      activeConversation = { ...activeConversation, title: event.title, titleState: "final" };
    }
    if (event.type === "delta" || event.type === "tool") {
      activeRequestId = event.requestId;
    } else if (event.type === "done" || event.type === "error") {
      activeRequestId = null;
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
      permUnlisten?.();
      permBubble.destroy();
      skillPicker.destroy();
      mentionPicker.destroy();
      document.removeEventListener("pointerdown", onDocumentPointerDown);
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
    setInputOpen,
    isInputOpen() {
      return inputOpen;
    },
    isStreaming() {
      return isChatStreaming(state);
    },
    cancel() {
      if (activeRequestId) deps.cancel?.(activeRequestId);
    },
    startNewConversation() {
      void startNewConversation();
    },
    isHistoryPopoverOpen() {
      return !historyPopover.hidden;
    },
    closeHistoryPopover,
    isPermissionBubbleOpen() {
      return permBubble.isOpen();
    },
    closePermissionBubble() {
      permBubble.reject();
    },
    isSkillMenuOpen() {
      return skillPicker.isOpen();
    },
    closeSkillMenu() {
      skillPicker.close();
    },
    isMentionMenuOpen() {
      return mentionPicker.isOpen();
    },
    closeMentionMenu() {
      mentionPicker.close();
    },
  };
}
