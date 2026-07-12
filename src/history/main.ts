import { emit, listen } from "@tauri-apps/api/event";
import { confirm } from "@tauri-apps/plugin-dialog";
import "@phosphor-icons/web/regular";
import { chatClearBeforeEntries, chatDelete, chatListAll, chatUpdateTitle, type ChatConversation } from "../platform/chat-history";
import { formatHistoryTime } from "../platform/chat-history-format";
import { filterAndGroupHistory, scopeFilterKey } from "./history-model";
import { createButton } from "../shared/ui/button";
import { createMenu } from "../shared/ui/menu";
import { initializeAppearance } from "../shared/appearance";

void initializeAppearance();

const PAGE_SIZE = 60;
const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <main class="history-shell">
    <nav class="history-toolbar" aria-label="对话历史工具栏">
      <label class="history-filter-label">项目 <select class="history-project-filter" aria-label="按项目筛选"><option value="all">全部项目</option></select></label>
      <div class="history-spacer"></div>
      ${createButton({ variant: "secondary", icon: "ph-broom", iconOnly: true, label: "清理旧记录", title: "清理旧记录" }).outerHTML}
    </nav>
    <section class="history-list" aria-label="对话历史"></section>
    ${createButton({ variant: "secondary", label: "加载更多" }).outerHTML}
  </main>`;

const listEl = app.querySelector<HTMLElement>(".history-list")!;
const moreBtn = app.querySelector<HTMLButtonElement>(".fn-btn--secondary:last-child")!;
const filterEl = app.querySelector<HTMLSelectElement>(".history-project-filter")!;
const clearTrigger = app.querySelector<HTMLButtonElement>(".history-toolbar .fn-btn")!;
const clearMenu = createMenu({ anchor: clearTrigger, placement: "down-right", inside: [clearTrigger] });
let conversations: ChatConversation[] = [];
let cursor = 0;
let loading = false;
let activeConversationId: string | null = null;

void reload();
void listen<string>("chat://active", (event) => { activeConversationId = event.payload; render(); });
void listen("chat://history-changed", () => { void reload(); });
filterEl.addEventListener("change", render);
moreBtn.addEventListener("click", () => { void loadMore(); });
clearTrigger.addEventListener("click", () => {
  if (clearMenu.isOpen()) return clearMenu.hide();
  clearMenu.show([clearItem(7), clearItem(30)]);
});

async function reload() {
  cursor = 0;
  conversations = [];
  await loadMore();
}

async function loadMore() {
  if (loading) return;
  loading = true;
  moreBtn.disabled = true;
  try {
    const page = await chatListAll(cursor, PAGE_SIZE);
    cursor += page.length;
    conversations = [...conversations, ...page];
    syncFilterOptions();
    moreBtn.hidden = page.length < PAGE_SIZE;
    render();
  } finally { loading = false; moreBtn.disabled = false; }
}

function syncFilterOptions() {
  const selected = filterEl.value;
  const scopes = new Map<string, string>();
  for (const item of conversations) scopes.set(scopeFilterKey(item.scopeType, item.scopePath), item.scopeLabel);
  filterEl.replaceChildren(new Option("全部项目", "all"), ...[...scopes.entries()].map(([key, label]) => new Option(label, key)));
  filterEl.value = scopes.has(selected) || selected === "all" ? selected : "all";
}

function render() {
  listEl.replaceChildren();
  const groups = filterAndGroupHistory(conversations, filterEl.value);
  if (!groups.length) {
    const empty = document.createElement("div"); empty.className = "history-empty";
    empty.textContent = conversations.length ? "该项目还没有对话" : "还没有对话";
    listEl.appendChild(empty); return;
  }
  for (const group of groups) {
    const heading = document.createElement("h2"); heading.className = "history-group"; heading.textContent = group.label;
    listEl.appendChild(heading);
    for (const conversation of group.conversations) listEl.appendChild(renderRow(conversation));
  }
}

function renderRow(conversation: ChatConversation): HTMLElement {
  const row = document.createElement("article");
  row.className = "history-row";
  row.toggleAttribute("data-active", conversation.id === activeConversationId);
  const main = document.createElement("button"); main.type = "button"; main.className = "history-row-main";
  main.setAttribute("aria-current", conversation.id === activeConversationId ? "true" : "false");
  main.addEventListener("click", () => { void emit("chat://open-id", conversation.id); });
  const title = document.createElement("span"); title.className = "history-title"; title.textContent = conversation.title;
  const meta = document.createElement("span"); meta.className = "history-meta";
  meta.textContent = `${conversation.scopeLabel} · ${formatHistoryTime(conversation.updatedAt)}`;
  main.append(title, meta);
  const trigger = createButton({ variant: "ghost", icon: "ph-dots-three", iconOnly: true, label: "更多操作", title: "更多操作" });
  trigger.classList.add("history-more-actions");
  const menu = createMenu({ anchor: trigger, placement: "down-right", inside: [trigger] });
  trigger.addEventListener("click", () => menu.isOpen() ? menu.hide() : menu.show([renameItem(conversation, row), deleteItem(conversation, row, menu)]));
  row.append(main, trigger); return row;
}

function renameItem(conversation: ChatConversation, row: HTMLElement): HTMLButtonElement {
  const item = document.createElement("button"); item.className = "fn-menu__item"; item.textContent = "重命名";
  item.addEventListener("click", () => {
    const input = document.createElement("input"); input.className = "fn-control history-rename"; input.value = conversation.title;
    const save = async () => { const title = input.value.trim(); if (!title) return; const updated = await chatUpdateTitle(conversation.id, title, "manual"); if (updated) { conversations = conversations.map((entry) => entry.id === updated.id ? updated : entry); void emit("chat://history-changed"); render(); } };
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") void save(); if (event.key === "Escape") render(); });
    row.querySelector(".history-row-main")!.replaceWith(input); input.focus(); input.select();
  }); return item;
}

function deleteItem(conversation: ChatConversation, row: HTMLElement, menu: ReturnType<typeof createMenu>): HTMLButtonElement {
  const item = document.createElement("button"); item.className = "fn-menu__item history-delete"; item.textContent = "删除";
  item.addEventListener("click", async () => {
    menu.hide();
    if (!await confirm(`删除「${conversation.title}」？`, { title: "删除对话", kind: "warning" })) return;
    if (!await confirm("删除后无法恢复。这会永久删除本地保存的对话及其会话数据。", { title: "确认永久删除", kind: "warning" })) return;
    const deleted = await chatDelete(conversation.id); if (!deleted) return;
    conversations = conversations.filter((entry) => entry.id !== conversation.id); row.remove();
    if (activeConversationId === conversation.id) { activeConversationId = null; void emit("chat://deleted", conversation.id); }
    void emit("chat://history-changed"); render();
  }); return item;
}

function clearItem(days: number): HTMLButtonElement {
  const item = document.createElement("button"); item.className = "fn-menu__item"; item.textContent = `清理 ${days} 天前的记录`;
  item.addEventListener("click", async () => {
    clearMenu.hide(); const cutoff = Date.now() - days * 86_400_000;
    if (!await confirm(`清理 ${days} 天前的对话？`, { title: "清理旧记录", kind: "warning" })) return;
    const count = conversations.filter((entry) => entry.updatedAt < cutoff).length;
    if (!await confirm(`将删除 ${count} 条对话。删除后无法恢复。`, { title: "确认永久清理", kind: "warning" })) return;
    const removed = await chatClearBeforeEntries(cutoff);
    conversations = conversations.filter((entry) => !removed.some((deleted) => deleted.id === entry.id));
    if (removed.some((deleted) => deleted.id === activeConversationId)) { activeConversationId = null; void emit("chat://deleted", ""); }
    await reload(); void emit("chat://history-changed");
  }); return item;
}
