import { emit } from "@tauri-apps/api/event";
import "@phosphor-icons/web/regular";
import {
  chatClearBefore,
  chatDelete,
  chatListAll,
  type ChatConversation,
} from "../platform/chat-history";
import { formatHistoryTime } from "../platform/chat-history-format";
import { createIcon } from "../shared/ui/icon";
import { createButton } from "../shared/ui/button";
import { createMenu } from "../shared/ui/menu";

function buttonMarkup(
  className: string,
  options: Parameters<typeof createButton>[0],
): string {
  const button = createButton(options);
  button.classList.add(className);
  return button.outerHTML;
}

/** 加载更多：共享 secondary 按钮，附加布局钩子。 */
function createHistoryMoreButton(): string {
  return buttonMarkup("history-more", { variant: "secondary", label: "加载更多" });
}

const PAGE_SIZE = 60;
const app = document.querySelector<HTMLElement>("#app")!;

app.innerHTML = `
  <main class="history-shell">
    <nav class="history-toolbar" aria-label="对话历史工具栏">
      <span class="history-mark" aria-hidden="true">${createIcon({ phosphor: "ph ph-clock-counter-clockwise", size: 17 }).outerHTML}</span>
      <div class="history-spacer"></div>
      ${buttonMarkup("history-reload", {
        variant: "secondary",
        icon: "ph-arrow-clockwise",
        iconOnly: true,
        label: "刷新",
        title: "刷新",
      })}
      ${buttonMarkup("history-clear-trigger", {
        variant: "secondary",
        icon: "ph-broom",
        iconOnly: true,
        label: "清理旧对话",
        title: "清理旧对话",
      })}
    </nav>
    <section class="history-list" aria-label="对话历史"></section>
    ${createHistoryMoreButton()}
  </main>
`;

const listEl = app.querySelector<HTMLElement>(".history-list")!;
const moreBtn = app.querySelector<HTMLButtonElement>(".history-more")!;
const reloadBtn = app.querySelector<HTMLButtonElement>(".history-reload")!;
const clearTrigger = app.querySelector<HTMLButtonElement>(".history-clear-trigger")!;
const clearMenu = createMenu({ anchor: clearTrigger, placement: "down-right", inside: [clearTrigger] });
let cursor = 0;
let loading = false;

void reload();

moreBtn.addEventListener("click", () => {
  void loadMore();
});

reloadBtn.addEventListener("click", () => {
  void reload();
});

clearTrigger.addEventListener("click", () => {
  if (clearMenu.isOpen()) {
    clearMenu.hide();
    return;
  }
  clearMenu.show([createClearMenuItem(7), createClearMenuItem(30)]);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") clearMenu.hide();
});

async function reload() {
  cursor = 0;
  listEl.replaceChildren();
  await loadMore();
}

async function loadMore() {
  if (loading) return;
  loading = true;
  moreBtn.disabled = true;
  try {
    const conversations = await chatListAll(cursor, PAGE_SIZE);
    cursor += conversations.length;
    for (const conversation of conversations) {
      listEl.appendChild(renderRow(conversation));
    }
    moreBtn.hidden = conversations.length < PAGE_SIZE;
    if (cursor === 0) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = "还没有对话";
      listEl.appendChild(empty);
    }
  } finally {
    loading = false;
    moreBtn.disabled = false;
  }
}

async function clearBeforeDays(days: number) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  if (!confirm(`清理 ${days} 天前的对话？此操作会删除对应 session 文件。`)) return;
  await chatClearBefore(cutoff);
  await reload();
}

function renderRow(conversation: ChatConversation): HTMLElement {
  const row = document.createElement("article");
  row.className = "history-row";

  const main = document.createElement("button");
  main.type = "button";
  main.className = "history-row-main";
  main.addEventListener("click", () => {
    void emit("chat://open", conversation);
  });

  const title = document.createElement("span");
  title.className = "history-title";
  title.textContent = conversation.title;
  const meta = document.createElement("span");
  meta.className = "history-meta";
  const scope = document.createElement("span");
  scope.className = "history-scope";
  scope.textContent = conversation.scopeLabel;
  const time = document.createElement("span");
  time.className = "history-time";
  time.textContent = formatHistoryTime(conversation.updatedAt);
  meta.append(scope, time);
  main.append(title, meta);

  const del = createButton({
    variant: "ghost",
    icon: "ph-trash",
    iconOnly: true,
    label: "删除",
    title: "删除",
  });
  del.classList.add("history-delete");
  del.addEventListener("click", async () => {
    if (!confirm(`删除「${conversation.title}」？`)) return;
    await chatDelete(conversation.id);
    row.remove();
  });

  row.append(main, del);
  return row;
}

function createClearMenuItem(days: number): HTMLButtonElement {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "fn-menu__item";
  item.textContent = `${days} 天前`;
  item.addEventListener("click", () => {
    clearMenu.hide();
    void clearBeforeDays(days);
  });
  return item;
}
