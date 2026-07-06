/** Tiny transient toast anchored at the inbox bottom (e.g. delete-undo notice). */
let toastEl: HTMLElement | null = null;
let dismissTimer: number | null = null;

export function showToast(message: string): void {
  if (dismissTimer !== null) {
    window.clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  toastEl?.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  document.body.appendChild(el);
  toastEl = el;
  dismissTimer = window.setTimeout(() => {
    el.classList.add("toast-leave");
    window.setTimeout(() => {
      el.remove();
      if (toastEl === el) toastEl = null;
    }, 200);
    dismissTimer = null;
  }, 4000);
}
