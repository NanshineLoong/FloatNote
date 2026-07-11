import type { UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AgentEvent } from "../platform/agent";
import type { ChatConversation, ChatScope } from "../platform/chat-history";
import { deriveTitleFromFirstMessage, formatHistoryTime } from "../platform/chat-history-format";
import socratesSvg from "../assets/socrates.svg?raw";
import { mountPermissionBubble, type PermissionRequest } from "./permission-bubble.js";
import type { SkillSummary } from "./skill-picker.js";
import type { MentionFile } from "./mention-picker.js";
import { mountComposer, type ComposerHandle } from "./input/composer";
import { composePromptPayload, type PromptPayload } from "./input/submit";
import {
  type ChatEvent,
  type ChatState,
  emptyChat,
  isChatStreaming,
  reduceEvents,
} from "./render";
import { reconcileMessages } from "./blocks";
import { createButton } from "../shared/ui/button";

/**
 * 与挂载点无关的助手组件。挂在笔记窗内的 `#assistant-region`，inline/floating 共用同一份。
 *
 * 依赖经 `deps` 注入（发送 / 订阅），故组件本身不直接依赖 Tauri，便于测试与复用。
 * 状态用 render.ts 的纯 reducer 维护；DOM 只是状态的薄投影。
 */
export interface AssistantDeps {
  /** 发送一条用户消息给 tutor，返回 requestId（用于取消）。 */
  send: (payload: PromptPayload, conversationId: string) => Promise<string>;
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
  const newConversationButton = createButton({
    variant: "secondary",
    icon: "ph-plus",
    iconOnly: true,
    label: "新对话",
    title: "新对话",
  });
  newConversationButton.classList.add("assistant-new");
  const historyButton = createButton({
    variant: "primary",
    icon: "ph-clock-counter-clockwise",
    iconOnly: true,
    label: "查看项目对话历史",
    title: "查看项目对话历史",
  });
  historyButton.classList.add("assistant-send");
  root.innerHTML = `
    <div class="assistant-card">
      ${newConversationButton.outerHTML}
      <div class="assistant-scroll"></div>
    </div>
    <div class="assistant-dock">
      <button class="assistant-bot" type="button" aria-label="展开输入框">${socratesSvg}</button>
      <div class="fn-popover assistant-history-popover" hidden></div>
      <div class="assistant-perm-region"></div>
      <div class="assistant-input-wrap">
        <div class="assistant-input-host"></div>
        <button class="assistant-expand" type="button" aria-label="展开输入框" title="展开输入框"><i class="ph ph-arrows-out"></i></button>
        ${historyButton.outerHTML}
      </div>
    </div>
  `;

  const scroll = root.querySelector<HTMLElement>(".assistant-scroll")!;
  const newBtn = root.querySelector<HTMLButtonElement>(".assistant-new")!;
  const bot = root.querySelector<HTMLButtonElement>(".assistant-bot")!;
  const inputWrap = root.querySelector<HTMLElement>(".assistant-input-wrap")!;
  const inputHost = root.querySelector<HTMLElement>(".assistant-input-host")!;
  const expandBtn = root.querySelector<HTMLButtonElement>(".assistant-expand")!;
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
    if (open) setTimeout(() => composer.focus(), 160);
    else (document.activeElement instanceof HTMLElement ? document.activeElement : null)?.blur();
    if (!open) closeHistoryPopover();
  }

  bot.addEventListener("click", () => setInputOpen(!inputOpen));

  function updateSendMode() {
    const payload = composePromptPayload(composer.getDoc());
    const hasContent = payload.userText.trim().length > 0 || payload.references.length > 0;
    sendBtn.setAttribute("aria-label", hasContent ? "发送" : "查看项目对话历史");
    sendBtn.title = hasContent ? "发送" : "查看项目对话历史";
    sendBtn.innerHTML = hasContent
      ? `<i class="ph ph-arrow-up"></i>`
      : `<i class="ph ph-clock-counter-clockwise"></i>`;
  }

  async function submit(payload: PromptPayload) {
    const text = payload.userText.trim();
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
    dispatch({ type: "user", conversationId: conversation.id, text });
    dispatch({ type: "pending", conversationId: conversation.id });
    try {
      activeRequestId = await deps.send({ ...payload, userText: text }, conversation.id);
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

  const composer: ComposerHandle = mountComposer({
    editorHost: inputHost,
    wrapHost: inputWrap,
    placeholder: "说点什么…",
    getScope: () => currentScope,
    listFiles: deps.listFiles,
    listSkills: deps.listSkills,
    onSubmit: (payload) => { void submit(payload); },
    onEmptySend: () => { void toggleHistoryPopover(); },
    onChange: updateSendMode,
  });
  sendBtn.addEventListener("click", () => composer.submit());
  expandBtn.addEventListener("click", () => composer.expandLarge());
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
    return resolvePermission(req.request_id, decision, writeMode);
  });
  bot.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    setInputOpen(true);
    composer.openSkillPicker();
  });

  /** 统一的 permission resolve 入口：派发 reducer 状态 + 调 Rust + 清 dock 兜底气泡。
   *  流内 action 卡与 dock 兜底气泡共用，以 requestId 为幂等键。 */
  function resolvePermission(
    requestId: string,
    decision: "allow" | "deny",
    writeMode: "direct" | "snapshot",
  ): Promise<void> {
    dispatch({ type: "permission_resolve", requestId, decision });
    return invoke("resolve_permission", { requestId, decision, writeMode }).then(() => {
      permBubble.clear();
    }).catch((err) => {
      dispatch({ type: "permission_resolve_failed", requestId, message: err instanceof Error ? err.message : String(err) });
      throw err;
    });
  }

  // 流内 action 卡的允许/拒绝按钮派发 chat:resolve（bubbles），在此统一处理。
  scroll.addEventListener("chat:resolve", (e) => {
    const detail = (e as CustomEvent).detail as {
      requestId: string;
      decision: "allow" | "deny";
      writeMode: "direct" | "snapshot";
    };
    void resolvePermission(detail.requestId, detail.decision, detail.writeMode).catch(() => {});
  });

  // thinking 块折叠/展开切换。
  scroll.addEventListener("chat:toggle-thinking", (e) => {
    const detail = (e as CustomEvent).detail as { blockId: string };
    dispatch({ type: "thinking_toggle", blockId: detail.blockId });
  });

  scroll.addEventListener("chat:retry", (e) => {
    const { blockId } = (e as CustomEvent).detail as { blockId: string };
    const messageIndex = state.messages.findIndex(
      (message) => message.role === "assistant" && message.blocks.some((block) => block.id === blockId),
    );
    if (messageIndex < 0 || !activeConversation || isChatStreaming(state)) return;
    for (let i = messageIndex - 1; i >= 0; i--) {
      const message = state.messages[i];
      if (message.role !== "user") continue;
      dispatch({ type: "pending", conversationId: activeConversation.id });
      // 历史消息仅保存展示文本；旧会话与纯文本消息重试时保持向后兼容。
      void deps.send({ userText: message.text, references: [] }, activeConversation.id).then((requestId) => {
        activeRequestId = requestId;
      }).catch((err) => {
        dispatch({
          type: "error",
          requestId: null,
          conversationId: activeConversation?.id,
          message: err instanceof Error ? err.message : String(err),
        });
      });
      break;
    }
  });

  // permission://request：优先填充流内 action 卡；若无匹配卡（非流式即时请求），
  // 回退到 dock 固定气泡。
  let permUnlisten: UnlistenFn | null = null;
  listen<PermissionRequest>("permission://request", (e) => {
    const req = e.payload;
    dispatch({
      type: "permission_request",
      requestId: req.request_id,
      callId: req.tool_call_id,
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
      composer.destroy();
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      root.classList.remove("assistant");
      root.innerHTML = "";
    },
    setScope(scope: ChatScope | null) {
      currentScope = scope;
      composer.setScope(scope);
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
      return composer.isPopoverOpen();
    },
    closeSkillMenu() {
      composer.closePopover();
    },
    isMentionMenuOpen() {
      return false;
    },
    closeMentionMenu() {
      composer.closePopover();
    },
  };
}
