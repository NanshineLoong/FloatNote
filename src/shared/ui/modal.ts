/**
 * Shared in-DOM modal / dialog (net-new). Native Tauri `confirm` (via
 * `src/note/notes-state.ts:182 confirmDialog`) stays for OS-level confirms;
 * this is for styled in-DOM dialogs (rename prompts, confirm-with-input,
 * settings confirmations) that need a focus trap + styled backdrop.
 *
 * Ships unused this round. CSS is `.fn-modal*` in `src/styles/components.css`.
 */

export interface ModalOptions {
  title?: string;
  content: HTMLElement | string;
  footer?: HTMLElement;
  size?: "sm" | "md";
  onclose?: (reason: "escape" | "overlay" | "programmatic") => void;
}

export interface ModalHandle {
  el: HTMLDivElement;
  close(): void;
  /** Focus the first focusable; restores the previously-focused element. */
  focus(): void;
}

const FOCUSABLE =
  'a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

export function openModal(opts: ModalOptions): ModalHandle {
  const { title, content, footer, size = "sm", onclose } = opts;
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const backdrop = document.createElement("div");
  backdrop.className = "fn-modal__backdrop";

  const dialog = document.createElement("div");
  dialog.className = `fn-modal__dialog fn-modal__dialog--${size}`;

  if (title) {
    const h = document.createElement("div");
    h.className = "fn-modal__header";
    h.textContent = title;
    dialog.appendChild(h);
  }

  const body = document.createElement("div");
  body.className = "fn-modal__body";
  if (typeof content === "string") body.textContent = content;
  else body.appendChild(content);
  dialog.appendChild(body);

  if (footer) {
    const f = document.createElement("div");
    f.className = "fn-modal__footer";
    f.appendChild(footer);
    dialog.appendChild(f);
  }

  backdrop.appendChild(dialog);
  document.body.appendChild(backdrop);

  let closed = false;
  function close(reason: "escape" | "overlay" | "programmatic" = "programmatic"): void {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    previouslyFocused?.focus();
    onclose?.(reason);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close("escape");
      return;
    }
    if (e.key !== "Tab") return;
    const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (n) => !n.hasAttribute("disabled"),
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function focus(): void {
    const first = dialog.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog).focus();
  }

  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close("overlay");
  });
  document.addEventListener("keydown", onKey);
  if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
  focus();

  return { el: backdrop, close, focus };
}
