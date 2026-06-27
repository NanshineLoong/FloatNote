/**
 * 自绘滚动指示条。`thumbParent` 是承载滑块的定位元素（不滚动），`scroller` 是
 * 真正滚动的元素 —— 二者可不同：inbox 里 `.cm-scroller` 在 editor-root 内部滚，
 * 写作栏里滚动发生在外层容器、滑块挂在更外层的非滚动列上。
 */
export function initScrollbar(
  thumbParent: HTMLElement,
  scroller: HTMLElement | null = thumbParent.querySelector<HTMLElement>(".cm-scroller"),
): void {
  if (!scroller) return;

  const thumb = document.createElement("div");
  thumb.className = "scroll-thumb";
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
    thumb.classList.add("visible");

    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      thumb.classList.remove("visible");
      timer = null;
    }, 900);
  }

  scroller.addEventListener("scroll", update, { passive: true });
}
