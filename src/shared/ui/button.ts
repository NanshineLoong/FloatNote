/**
 * Shared button. Consolidates the 5+ per-window button systems (`.icon-btn`,
 * `.popup-btn*`, `.settings-btn-*`, `.history-icon-btn`, `.empty-state-btn`,
 * raw `<button>` in popup.html) behind one factory + the `.fn-btn*` contract in
 * `src/styles/components.css`.
 *
 * Ships unused this round; call sites migrate incrementally (Phase C).
 */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Phosphor glyph class WITHOUT the `ph ` prefix, e.g. "ph-pencil-simple". */
  icon?: string;
  /** Render a circular icon-only button (`.fn-btn--icon`); `label` becomes the
   * accessible name. */
  iconOnly?: boolean;
  label?: string;
  title?: string;
  disabled?: boolean;
  /** Toggle the `.is-on` selected state (replaces `.icon-btn.on`). */
  pressed?: boolean;
  onClick?: () => void;
}

export function createButton(opts: ButtonOptions = {}): HTMLButtonElement {
  const {
    variant = "secondary",
    size = "md",
    icon,
    iconOnly = false,
    label,
    title,
    disabled = false,
    pressed = false,
    onClick,
  } = opts;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = ["fn-btn", `fn-btn--${variant}`, size === "sm" ? "fn-btn--sm" : ""]
    .filter(Boolean)
    .join(" ");
  if (iconOnly) btn.classList.add("fn-btn--icon");
  if (pressed) btn.classList.add("is-on");

  if (icon) {
    const i = document.createElement("i");
    i.className = `ph ${icon}`;
    i.setAttribute("aria-hidden", "true");
    btn.appendChild(i);
  }
  if (label) {
    const span = document.createElement("span");
    span.className = "fn-btn__label";
    span.textContent = label;
    btn.appendChild(span);
  }
  if (title) btn.title = title;
  if (iconOnly && label) btn.setAttribute("aria-label", label);
  if (disabled) btn.disabled = true;
  if (onClick) btn.addEventListener("click", () => onClick());
  return btn;
}
