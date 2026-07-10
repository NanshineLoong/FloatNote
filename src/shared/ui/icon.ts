/**
 * Shared icon wrapper. Unifies the two existing icon systems behind one entry
 * point: Phosphor web-font glyphs (`<i class="ph ph-…">`, ~28 glyphs across 14
 * files) and the hand-inlined SVGs in `src/assistant/action-card.ts`.
 *
 * Ships unused this round; call sites migrate incrementally (Phase C).
 */

export interface IconOptions {
  /** Full Phosphor class, e.g. "ph ph-pencil-simple". */
  phosphor?: string;
  /** Raw inline SVG markup (the action-card pattern). */
  svg?: string;
  size?: number;
  /** Accessible label; if absent, the icon is `aria-hidden`. */
  label?: string;
}

export function createIcon(opts: IconOptions): HTMLElement {
  const { phosphor, svg, size = 16, label } = opts;
  const el = svg ? document.createElement("span") : document.createElement("i");
  el.className = "fn-icon";
  el.style.fontSize = `${size}px`;
  if (svg) {
    el.innerHTML = svg;
  } else if (phosphor) {
    const cls = el.className;
    el.className = `${cls} ${phosphor}`;
  }
  if (label) {
    el.setAttribute("aria-label", label);
  } else {
    el.setAttribute("aria-hidden", "true");
  }
  return el;
}
