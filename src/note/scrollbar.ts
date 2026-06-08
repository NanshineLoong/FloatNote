export function initScrollbar(container: HTMLElement): void {
  const scroller = container.querySelector<HTMLElement>(".cm-scroller");
  if (!scroller) return;

  const thumb = document.createElement("div");
  thumb.className = "scroll-thumb";
  container.appendChild(thumb);

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
