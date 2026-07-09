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
  clampIntoViewport(el);
  setTimeout(() => document.addEventListener("pointerdown", closeFloating, { once: true }), 0);
}

/** 把已挂载的 fixed 浮层裁进视口：右/下溢出则回拉，左/上为负则贴边。
 *  小人在主窗口右下角时，光标式菜单（如右键小人旧路径、标签右键）会越出视口被裁，
 *  此处统一兜底。浮层自身有 max-height + overflow:auto，rect 为实际渲染尺寸。 */
function clampIntoViewport(el: HTMLElement): void {
  const M = 8;
  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = parseFloat(el.style.left) || 0;
  let top = parseFloat(el.style.top) || 0;
  if (Number.isFinite(vw) && rect.width + M * 2 < vw) {
    if (left + rect.width + M > vw) left = vw - rect.width - M;
    if (left < M) left = M;
  } else if (Number.isFinite(vw)) {
    left = M;
  }
  if (Number.isFinite(vh) && rect.height + M * 2 < vh) {
    if (top + rect.height + M > vh) top = vh - rect.height - M;
    if (top < M) top = M;
  } else if (Number.isFinite(vh)) {
    top = M;
  }
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

/** 锚定式浮层：相对一个 anchor 矩形按方向展开，垂直放不下则翻到另一侧，水平溢出则 clamp。
 *  用于右键小人技能菜单：收起态开在小人左上方（up-left），展开态开在右上方（up-right）。 */
export function floatMenuAnchored(
  el: HTMLElement,
  anchor: DOMRect,
  prefer: "up-left" | "up-right" | "up",
): void {
  closeFloating();
  el.classList.add("tag-floating");
  document.body.appendChild(el); // 先挂载以测尺寸
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  const M = 8;
  const gap = 6;
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 垂直：默认开在 anchor 上方；上方放不下则翻到下方；都不行则贴顶/贴底。
  let top: number;
  if (Number.isFinite(vh) && r.height + M * 2 < vh && anchor.top - gap - r.height >= M) {
    top = anchor.top - gap - r.height;
  } else if (Number.isFinite(vh) && anchor.bottom + gap + r.height + M <= vh) {
    top = anchor.bottom + gap; // flip 到下方
  } else if (Number.isFinite(vh)) {
    top = Math.max(M, vh - r.height - M);
  } else {
    top = anchor.top - gap - r.height;
  }

  // 水平：按 prefer 选左/右展开，超出视口则 clamp。
  let left: number;
  const placeLeft = () => anchor.left - gap - r.width; // 菜单右边贴 anchor 左边 → 向左展开
  const placeRight = () => anchor.right + gap; // 菜单左边贴 anchor 右边 → 向右展开
  if (prefer === "up-right") left = placeRight();
  else if (prefer === "up-left") left = placeLeft();
  else left = Math.max(M, Math.min(anchor.left, (Number.isFinite(vw) ? vw : anchor.left) - r.width - M));
  if (Number.isFinite(vw) && left + r.width + M > vw) left = vw - r.width - M;
  if (left < M) left = M;

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  setTimeout(() => document.addEventListener("pointerdown", closeFloating, { once: true }), 0);
}

export function closeFloating(): void {
  document.querySelectorAll(".tag-floating").forEach((el) => el.remove());
}
