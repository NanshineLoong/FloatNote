/**
 * Self-painted scroll indicator. `thumbParent` is the positioning host (not
 * scrolled); `scroller` is the element that actually scrolls — they may differ
 * (inbox: `.cm-scroller` scrolls inside editor-root; writing column: scrolling
 * happens on an outer container, thumb挂在更外层的非滚动列上).
 *
 * Generalized from the note-only `src/note/scrollbar.ts` (now a re-export) so
 * history and assistant can adopt the same thumb. CSS lives in
 * `src/styles/components.css` as `.fn-scroll__thumb`.
 */
export function initScrollbar(
  thumbParent: HTMLElement,
  scroller: HTMLElement | null = thumbParent.querySelector<HTMLElement>(".cm-scroller"),
): void {
  if (!scroller) return;

  const thumb = document.createElement("div");
  thumb.className = "fn-scroll__thumb";
  thumbParent.appendChild(thumb);

  let timer: ReturnType<typeof setTimeout> | null = null;

  function update() {
    const { scrollTop, scrollHeight, clientHeight } = scroller!;
    if (scrollHeight <= clientHeight) return;

    const thumbH = Math.max(28, (clientHeight / scrollHeight) * clientHeight);
    const maxTop = clientHeight - thumbH;
    const thumbTop = (scrollTop / (scrollHeight - clientHeight)) * maxTop;

    thumb.style.height = `${thumbH}px`;
    thumb.style.top = `${thumbTop}px`;
    thumb.classList.add("is-visible");

    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      thumb.classList.remove("is-visible");
      timer = null;
    }, 900);
  }

  scroller.addEventListener("scroll", update, { passive: true });
}
