/** Shared helper for floating tag popovers (context menu, add popover, picker).
 *  Each popover closes any existing one, stops pointerdown propagation so inside
 *  clicks don't dismiss it, and auto-closes on the next outside pointerdown. */
export function floatMenu(el: HTMLElement, x: number, y: number): void {
  closeFloating();
  el.classList.add("tag-floating");
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  document.body.appendChild(el);
  setTimeout(() => document.addEventListener("pointerdown", closeFloating, { once: true }), 0);
}

export function closeFloating(): void {
  document.querySelectorAll(".tag-floating").forEach((el) => el.remove());
}
