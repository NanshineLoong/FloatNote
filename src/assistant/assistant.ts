import type { UnlistenFn } from "@tauri-apps/api/event";
import type { AgentEvent } from "../note/agent";
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
  send: (text: string) => unknown;
  /** 订阅 agent 流式事件；返回取消订阅句柄（同步或 Promise）。 */
  subscribe: (cb: (event: AgentEvent) => void) => UnlistenFn | Promise<UnlistenFn>;
}

export interface AssistantHandle {
  destroy: () => void;
}

export function mountAssistant(root: HTMLElement, deps: AssistantDeps): AssistantHandle {
  let state: ChatState = emptyChat();

  root.classList.add("assistant");
  root.innerHTML = `
    <div class="assistant-scroll"></div>
    <div class="assistant-dock">
      <button class="assistant-bot" type="button" aria-label="展开输入框">${socratesSvg}</button>
      <div class="assistant-input-wrap">
        <textarea class="assistant-input" rows="1" placeholder="和助手说点什么…"></textarea>
        <button class="assistant-send" type="button" aria-label="发送"><i class="ph ph-arrow-up"></i></button>
      </div>
    </div>
  `;

  const scroll = root.querySelector<HTMLElement>(".assistant-scroll")!;
  const bot = root.querySelector<HTMLButtonElement>(".assistant-bot")!;
  const inputWrap = root.querySelector<HTMLElement>(".assistant-input-wrap")!;
  const input = root.querySelector<HTMLTextAreaElement>(".assistant-input")!;
  const sendBtn = root.querySelector<HTMLButtonElement>(".assistant-send")!;

  function rerender() {
    scroll.replaceChildren(renderMessages(state));
    scroll.scrollTop = scroll.scrollHeight;
  }

  function dispatch(event: ChatEvent) {
    state = reduceEvents(state, event);
    rerender();
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
  }

  bot.addEventListener("click", () => setInputOpen(!inputOpen));

  function autosize() {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  function submit() {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    autosize();
    dispatch({ type: "user", text });
    deps.send(text);
  }

  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  });
  sendBtn.addEventListener("click", submit);

  rerender();

  let unlisten: UnlistenFn | null = null;
  let destroyed = false;
  Promise.resolve(deps.subscribe((event) => dispatch(event))).then((un) => {
    if (destroyed) un();
    else unlisten = un;
  });

  return {
    destroy() {
      destroyed = true;
      unlisten?.();
      root.classList.remove("assistant");
      root.innerHTML = "";
    },
  };
}
