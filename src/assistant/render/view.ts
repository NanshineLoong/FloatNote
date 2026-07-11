import type { Block, ChatMessage } from "./state";
import { buildActionCard } from "../action-card";
import { fillMarkdown } from "../markdown";
import { createIcon } from "../../shared/ui/icon";

/**
 * 助手聊天的 DOM 渲染层：把 state.ts 产出的 `ChatMessage`/`Block` 投影成
 * 可复用的 DOM 节点。状态与渲染分离——`reduceEvents` 是纯函数，DOM 增量
 * 复用由 `blocks.ts` 驱动（按稳定 message/block id 复用而非全量重建）。
 */

/**
 * 在气泡下方挂载复制按钮（hover 浮出）。一次性挂载：节点稳定，
 * 不随 token delta 重建。复制原始 markdown 文本（非渲染后纯文本）。
 * align: "left"（AI 气泡，靠左）/ "right"（用户气泡，靠右）。
 */
function attachCopyButton(textEl: HTMLElement, rawText: string, align: "left" | "right" = "left"): void {
  textEl.dataset.copyText = rawText;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chat-message-action chat-copy-btn" + (align === "right" ? " is-right" : "");
  btn.setAttribute("aria-label", "复制原文");
  btn.title = "复制";
  btn.append(createIcon({ phosphor: "ph ph-copy", size: 14 }));
  btn.addEventListener("click", () => {
    void copyText(textEl.dataset.copyText ?? "").then((ok) => {
      if (!ok) return;
      btn.title = "已复制";
      btn.setAttribute("aria-label", "已复制");
      btn.replaceChildren(createIcon({ phosphor: "ph ph-check", size: 14 }));
      btn.classList.add("is-copied");
      window.setTimeout(() => {
        btn.title = "复制";
        btn.setAttribute("aria-label", "复制原文");
        btn.replaceChildren(createIcon({ phosphor: "ph ph-copy", size: 14 }));
        btn.classList.remove("is-copied");
      }, 1200);
    });
  });
  ensureMessageActions(textEl, align).appendChild(btn);
}

function ensureMessageActions(textEl: HTMLElement, align: "left" | "right" = "left"): HTMLElement {
  let actions = textEl.querySelector<HTMLElement>(":scope > .chat-message-actions");
  if (!actions) {
    actions = document.createElement("div");
    actions.className = `chat-message-actions${align === "right" ? " is-right" : ""}`;
    textEl.appendChild(actions);
  }
  return actions;
}

function attachRetryButton(textEl: HTMLElement, blockId: string, disabled: boolean): void {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "chat-message-action chat-retry-btn";
  btn.setAttribute("aria-label", "重试");
  btn.title = "重试";
  btn.disabled = disabled;
  btn.append(createIcon({ phosphor: "ph ph-arrow-clockwise", size: 14 }));
  btn.addEventListener("click", () => {
    textEl.dispatchEvent(new CustomEvent("chat:retry", { bubbles: true, detail: { blockId } }));
  });
  ensureMessageActions(textEl).appendChild(btn);
}

/** 复制文本：优先 navigator.clipboard，降级 execCommand 临时 textarea。 */
function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => legacyCopy(text));
  }
  return Promise.resolve(legacyCopy(text));
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export function decorateCodeBlocks(root: HTMLElement): void {
  for (const pre of root.querySelectorAll<HTMLElement>("pre.chat-codeblock")) {
    if (pre.querySelector(":scope > .chat-code-copy")) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-code-copy";
    button.title = "复制代码";
    button.setAttribute("aria-label", "复制代码");
    button.append(createIcon({ phosphor: "ph ph-copy", size: 13 }));
    button.addEventListener("click", () => {
      const code = pre.querySelector("code")?.textContent ?? "";
      void copyText(code).then((ok) => {
        if (!ok) return;
        button.title = "已复制";
        button.setAttribute("aria-label", "已复制");
        button.replaceChildren(createIcon({ phosphor: "ph ph-check", size: 13 }));
      });
    });
    pre.appendChild(button);
  }
}

export function renderMessage(message: ChatMessage): HTMLElement {
  const el = document.createElement("div");
  el.className = `chat-msg chat-${message.role}`;
  el.dataset.messageId = message.id;
  if (message.role === "user") {
    const body = document.createElement("div");
    body.className = "chat-msg-text";
    body.textContent = message.text;
    el.appendChild(body);
    attachCopyButton(el, message.text, "right");
    return el;
  }
  // assistant：纵向平级块容器。
  const stack = document.createElement("div");
  stack.className = "chat-blocks";
  for (const block of message.blocks) {
    stack.appendChild(renderBlock(block, message.streaming));
  }
  el.appendChild(stack);
  return el;
}

/** 渲染单个块节点（可复用：reconcile 按需更新而非重建）。 */
export function renderBlock(block: Block, streaming: boolean): HTMLElement {
  const el = document.createElement("div");
  el.className = `chat-block chat-block-${block.kind}`;
  el.dataset.blockId = block.id;
  switch (block.kind) {
    case "wait": {
      el.classList.add("chat-wait");
      el.setAttribute("role", "status");
      const indicator = document.createElement("span");
      indicator.className = "chat-wait-indicator";
      indicator.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = block.label;
      el.append(indicator, label);
      break;
    }
    case "text": {
      el.classList.add("chat-text");
      const content = document.createElement("div");
      content.className = "chat-text-content";
      fillMarkdown(content, block.text);
      decorateCodeBlocks(content);
      el.appendChild(content);
      if (streaming) el.classList.add("chat-streaming");
      attachCopyButton(el, block.text);
      attachRetryButton(el, block.id, streaming);
      break;
    }
    case "thinking":
      el.classList.toggle("chat-thinking-collapsed", block.collapsed);
      el.classList.toggle("chat-thinking-done", block.done);
      {
        const head = document.createElement("button");
        head.type = "button";
        head.className = "chat-thinking-head";
        head.setAttribute("aria-expanded", String(!block.collapsed));
        const label = document.createElement("span");
        label.className = "chat-thinking-label";
        label.textContent = block.done ? "思考" : "思考中…";
        head.append(label);
        head.addEventListener("click", () => {
          el.dispatchEvent(new CustomEvent("chat:toggle-thinking", { bubbles: true, detail: { blockId: block.id } }));
        });
        const body = document.createElement("div");
        body.className = "chat-thinking-body";
        body.textContent = block.text;
        el.append(head, body);
      }
      break;
    case "action":
      // 动作卡由 action-card 模块构建（header/body/footer + 状态 class）。
      return buildActionCard(block);
    case "action_group": {
      el.classList.add("chat-action-group");
      const details = document.createElement("details");
      details.open = !block.collapsed && block.items.some((item) => item.execution === "running");
      const summary = document.createElement("summary");
      summary.textContent = block.summary;
      const items = document.createElement("div");
      items.className = "chat-action-group-items";
      for (const item of block.items) items.appendChild(buildActionCard(item));
      details.append(summary, items);
      el.appendChild(details);
      break;
    }
    case "error":
      el.setAttribute("role", "alert");
      el.textContent = block.text;
      break;
  }
  return el;
}
