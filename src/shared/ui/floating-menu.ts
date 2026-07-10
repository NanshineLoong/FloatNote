export function floatMenu(el: HTMLElement, x: number, y: number): void {
  closeFloating();
  el.classList.add("tag-floating");
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  document.body.appendChild(el);
  clampIntoViewport(el);
  setTimeout(() => document.addEventListener("pointerdown", closeFloating, { once: true }), 0);
}

function clampIntoViewport(el: HTMLElement): void {
  const margin = 8;
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = parseFloat(el.style.left) || 0;
  let top = parseFloat(el.style.top) || 0;
  if (Number.isFinite(vw) && rect.width + margin * 2 < vw) {
    if (left + rect.width + margin > vw) left = vw - rect.width - margin;
    if (left < margin) left = margin;
  } else if (Number.isFinite(vw)) left = margin;
  if (Number.isFinite(vh) && rect.height + margin * 2 < vh) {
    if (top + rect.height + margin > vh) top = vh - rect.height - margin;
    if (top < margin) top = margin;
  } else if (Number.isFinite(vh)) top = margin;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function floatMenuAnchored(el: HTMLElement, anchor: DOMRect, prefer: "up-left" | "up-right" | "up"): void {
  closeFloating();
  el.classList.add("tag-floating");
  document.body.appendChild(el);
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  const margin = 8;
  const gap = 6;
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top: number;
  if (Number.isFinite(vh) && rect.height + margin * 2 < vh && anchor.top - gap - rect.height >= margin) top = anchor.top - gap - rect.height;
  else if (Number.isFinite(vh) && anchor.bottom + gap + rect.height + margin <= vh) top = anchor.bottom + gap;
  else if (Number.isFinite(vh)) top = Math.max(margin, vh - rect.height - margin);
  else top = anchor.top - gap - rect.height;
  const placeLeft = () => anchor.left - gap - rect.width;
  const placeRight = () => anchor.right + gap;
  let left = prefer === "up-right" ? placeRight() : prefer === "up-left" ? placeLeft() : Math.max(margin, Math.min(anchor.left, (Number.isFinite(vw) ? vw : anchor.left) - rect.width - margin));
  if (Number.isFinite(vw) && left + rect.width + margin > vw) left = vw - rect.width - margin;
  if (left < margin) left = margin;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  setTimeout(() => document.addEventListener("pointerdown", closeFloating, { once: true }), 0);
}

export function closeFloating(): void {
  document.querySelectorAll(".tag-floating").forEach((el) => el.remove());
}
