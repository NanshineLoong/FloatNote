import { createButton } from "../shared/ui/button";

export function createHistoryMoreButton(): HTMLButtonElement {
  const button = createButton({ variant: "secondary", label: "加载更多" });
  button.classList.add("history-more");
  return button;
}

export function createClearAllHistoryItem(onClear: () => void | Promise<void>): HTMLButtonElement {
  const item = document.createElement("button");
  item.className = "fn-menu__item history-delete";
  item.textContent = "清理全部对话记录";
  item.addEventListener("click", () => { void onClear(); });
  return item;
}
