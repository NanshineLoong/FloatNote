import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { parseImage, writeAttrs, type ImageAlign, type ImageAttrs } from "./image-attrs";

interface Active {
  view: EditorView;
  figure: HTMLElement;
  from: number;
  to: number;
  raw: string;
}

let active: Active | null = null;
let toolbarEl: HTMLElement | null = null;

/** Find the Image node (plus trailing `{...}`) whose widget produced `figure`.
 *  Looks up the doc position of the figure DOM via `posAtDOM` (the widget's
 *  `from`) and resolves the Image syntax node containing that position, then
 *  extends `to` over a trailing `{...}` block scoped to the same line (mirrors
 *  preview.ts). Robust regardless of caption content — caption matching was
 *  dropped because most pasted images share an empty caption, so the first
 *  document-order match silently rewrote the WRONG image. Returns null if the
 *  position is not inside an Image node (e.g. widget torn down mid-drag). */
function locateImageRange(
  view: EditorView,
  figure: HTMLElement,
): { from: number; to: number; raw: string } | null {
  const pos = view.posAtDOM(figure);
  let found: { from: number; to: number; raw: string } | null = null;
  syntaxTree(view.state).iterate({
    enter(node) {
      if (found) return;
      if (node.name !== "Image") return;
      // The widget's `from` equals the Image node's `from`; accept the node
      // whose [from, to) contains `pos`.
      if (pos < node.from || pos >= node.to) return;
      let to = node.to;
      const after = view.state.doc.sliceString(node.to, node.to + 1);
      if (after === "{") {
        const line = view.state.doc.lineAt(node.to);
        const close = view.state.doc.sliceString(node.to, line.to).indexOf("}");
        if (close >= 0) to = node.to + close + 1;
      }
      found = {
        from: node.from,
        to,
        raw: view.state.doc.sliceString(node.from, to),
      };
    },
  });
  return found;
}

/** Find the currently-rendered figure whose `<img>.alt` equals `caption`. Used
 *  to re-attach the toolbar after a writeback rebuilds the widget DOM. */
function findFigureByCaption(view: EditorView, caption: string): HTMLElement | null {
  const figures = view.dom.querySelectorAll<HTMLElement>(".cm-preview-figure");
  for (const f of Array.from(figures)) {
    const img = f.querySelector("img");
    if (img && img.alt === caption) return f;
  }
  return null;
}

/** Rewrite the source slice with canonical attrs. The image node's `from` is
 *  stable (we only ever replace starting at `from`), but `to` shifts when the
 *  inserted text is longer/shorter than the old slice — so recompute `active`
 *  from the inserted length on every commit. This is what makes consecutive
 *  edits (align → resize → caption) work: without it, `active.to` goes stale
 *  and the next `parseImage(sliceString(from, to))` reads a truncated/garbled
 *  slice. */
function writeSource(attrs: ImageAttrs): void {
  if (!active) return;
  const { view, from } = active;
  const next = writeAttrs(attrs);
  view.dispatch({ changes: { from, to: active.to, insert: next } });
  active.to = from + next.length;
  active.raw = next;
}

/** After a writeback, the preview plugin rebuilds the ImgWidget DOM, destroying
 *  the figure that hosted the toolbar. Re-find the rebuilt figure (same caption)
 *  and move the toolbar into it; if it can't be found, close. */
function reattach(caption: string): void {
  if (!active || !toolbarEl) return;
  const newFigure = findFigureByCaption(active.view, caption);
  if (!newFigure) {
    closeToolbar();
    return;
  }
  active.figure = newFigure;
  newFigure.classList.add("cm-img-active");
  newFigure.appendChild(toolbarEl);
}

function openToolbar(view: EditorView, figure: HTMLElement): void {
  closeToolbar();
  const range = locateImageRange(view, figure);
  if (!range) return;
  const attrs = parseImage(range.raw) ?? { caption: "", url: "", width: null, align: null };
  active = { view, figure, from: range.from, to: range.to, raw: range.raw };

  const bar = document.createElement("div");
  bar.className = "cm-img-toolbar";

  const input = document.createElement("input");
  input.className = "cm-img-caption-input";
  input.value = attrs.caption;

  // The caption input is the live editor for the caption field; always trust
  // its value over the source (they only diverge before the first caption
  // writeback, while the user is mid-type).
  const currentAttrs = (): ImageAttrs => {
    const fb: ImageAttrs = attrs;
    const cur = active
      ? parseImage(view.state.doc.sliceString(active.from, active.to)) ?? fb
      : fb;
    return { ...cur, caption: input.value };
  };

  // Align buttons: 左 / 中 / 右. Clicking the active align clears it (→ left).
  for (const al of ["left", "center", "right"] as ImageAlign[]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = al === "left" ? "左" : al === "center" ? "中" : "右";
    b.onclick = (e) => {
      e.stopPropagation();
      if (!active) return;
      const cur = currentAttrs();
      const nextAlign: ImageAlign | null = cur.align === al ? null : al;
      writeSource({ ...cur, align: nextAlign });
      reattach(cur.caption);
    };
    bar.appendChild(b);
  }

  // Caption input: live-updates the figure's img.alt + figcaption (no source
  // write on every keystroke — that would rebuild the widget and destroy the
  // input mid-type). Source is committed on blur / Enter, which also closes.
  input.oninput = () => {
    if (!active) return;
    const img = active.figure.querySelector("img");
    if (img) img.alt = input.value;
    const fig = active.figure.querySelector("figcaption");
    if (fig) fig.textContent = input.value;
  };
  input.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      input.blur();
    } else if (e.key === "Escape") {
      closeToolbar();
    }
  };
  // Guard re-entrancy: dispatching removes the old figure (and the input) from
  // the DOM, which fires blur synchronously mid-commit.
  let inCommit = false;
  input.onblur = () => {
    if (inCommit || !active) return;
    inCommit = true;
    const cur = currentAttrs();
    writeSource({ ...cur, caption: input.value });
    inCommit = false;
    closeToolbar();
  };
  bar.appendChild(input);

  // Resize handle: pointer-drag changes img.style.width live; on release the
  // width is written back (rounded, min 40px). Re-query the img on every
  // handler: after a writeSource + reattach (align click, or a prior resize's
  // pointerup) the preview plugin rebuilds ImgWidget (its `eq` is keyed on
  // `raw`, which changed), discarding the old figure DOM. `reattach` updates
  // `active.figure` but a captured `img` const would still point at the
  // detached old img (offsetWidth → 0, no live preview, width anchored to 0).
  const handle = document.createElement("div");
  handle.className = "cm-img-resize-handle";
  bar.appendChild(handle);
  let dragging = false;
  let startX = 0;
  let startW = 0;
  handle.onpointerdown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!active) return;
    const img = active.figure.querySelector("img");
    if (!img) return; // figure torn down
    dragging = true;
    startX = e.clientX;
    startW = img.offsetWidth;
    handle.setPointerCapture(e.pointerId);
  };
  handle.onpointermove = (e) => {
    if (!dragging || !active) return;
    const img = active.figure.querySelector("img");
    if (!img) {
      dragging = false;
      return;
    }
    const w = Math.max(40, Math.round(startW + (e.clientX - startX)));
    img.style.width = `${w}px`;
  };
  handle.onpointerup = (e) => {
    if (!dragging) return;
    dragging = false;
    handle.releasePointerCapture(e.pointerId);
    if (!active) return;
    const img = active.figure.querySelector("img");
    if (!img) return; // figure torn down mid-drag — abort
    const w = Math.max(40, Math.round(startW + (e.clientX - startX)));
    const cur = currentAttrs();
    writeSource({ ...cur, width: w });
    reattach(cur.caption);
  };

  figure.classList.add("cm-img-active");
  figure.appendChild(bar);
  toolbarEl = bar;
}

function closeToolbar(): void {
  if (active) active.figure.classList.remove("cm-img-active");
  toolbarEl?.remove();
  toolbarEl = null;
  active = null;
}

/** Wire toolbar open/close onto an editor view. Call once per editor. */
export function attachImageToolbar(view: EditorView): () => void {
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    // Clicks on the toolbar itself (buttons / input / handle) must not re-open
    // or close the toolbar — let their own handlers run.
    if (toolbarEl && toolbarEl.contains(target)) return;
    const figure = target.closest(".cm-preview-figure") as HTMLElement | null;
    if (figure) {
      e.stopPropagation();
      if (active && active.figure === figure) return; // already active
      openToolbar(view, figure);
    } else {
      closeToolbar();
    }
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeToolbar();
  };
  view.dom.addEventListener("click", onClick);
  view.dom.addEventListener("keyup", onKey);
  return () => {
    view.dom.removeEventListener("click", onClick);
    view.dom.removeEventListener("keyup", onKey);
    closeToolbar();
  };
}
