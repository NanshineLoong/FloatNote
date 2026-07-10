import { emit } from "@tauri-apps/api/event";
import "@phosphor-icons/web/regular";
import {
  chatClearBefore,
  chatDelete,
  chatListAll,
  type ChatConversation,
} from "../platform/chat-history";
import { formatHistoryTime } from "../platform/chat-history-format";

const PAGE_SIZE = 60;
const app = document.querySelector<HTMLElement>("#app")!;

app.innerHTML = `
  <main class="history-shell">
    <nav class="history-toolbar" aria-label="对话历史工具栏">
      <span class="history-mark" aria-hidden="true"><i class="ph ph-clock-counter-clockwise"></i></span>
      <div class="history-spacer"></div>
      <button class="history-icon-btn history-reload" type="button" aria-label="刷新" title="刷新">
        <i class="ph ph-arrow-clockwise"></i>
      </button>
      <div class="history-clear-menu">
        <button class="history-icon-btn history-clear-trigger" type="button" aria-label="清理旧对话" title="清理旧对话">
          <i class="ph ph-broom"></i>
        </button>
        <div class="history-clear-options" hidden>
          <button type="button" data-days="7">7 天前</button>
          <button type="button" data-days="30">30 天前</button>
        </div>
      </div>
    </nav>
    <section class="history-list" aria-label="对话历史"></section>
    <button class="history-more" type="button">加载更多</button>
  </main>
`;

const listEl = app.querySelector<HTMLElement>(".history-list")!;
const moreBtn = app.querySelector<HTMLButtonElement>(".history-more")!;
const reloadBtn = app.querySelector<HTMLButtonElement>(".history-reload")!;
const clearTrigger = app.querySelector<HTMLButtonElement>(".history-clear-trigger")!;
const clearOptions = app.querySelector<HTMLElement>(".history-clear-options")!;
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
  clearOptions.hidden = !clearOptions.hidden;
});

clearOptions.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const days = Number(target.dataset.days);
  if (!Number.isFinite(days)) return;
  clearOptions.hidden = true;
  void clearBeforeDays(days);
});

document.addEventListener("pointerdown", (event) => {
  const target = event.target;
  if (target instanceof Node && app.querySelector(".history-clear-menu")?.contains(target)) return;
  clearOptions.hidden = true;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") clearOptions.hidden = true;
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

  const del = document.createElement("button");
  del.type = "button";
  del.className = "history-icon-btn history-delete";
  del.setAttribute("aria-label", "删除");
  del.title = "删除";
  del.innerHTML = `<i class="ph ph-trash"></i>`;
  del.addEventListener("click", async () => {
    if (!confirm(`删除「${conversation.title}」？`)) return;
    await chatDelete(conversation.id);
    row.remove();
  });

  row.append(main, del);
  return row;
}
