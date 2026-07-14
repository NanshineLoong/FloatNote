import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { parseImage, writeAttrs, type ImageAlign, type ImageAttrs } from "./image-attrs";
import { computeResize, HANDLE_SPECS, type HandleSpec } from "./image-resize";
import { imageSourceField, SetImageSourceEffect } from "./image-interaction";
import { createIcon } from "../shared/ui/icon";

interface Active {
  view: EditorView;
  figure: HTMLElement;
  from: number;
  to: number;
  raw: string;
}

let active: Active | null = null;
// Active overlays live as module singletons (not part of ImgWidget.toDOM):
// they're injected on open and re-appended after every widget rebuild.
let toolbarEl: HTMLElement | null = null; // div.cm-img-toolbar (align buttons only)
let handlesEl: HTMLElement | null = null; // div.cm-img-handles (8 resize handles)
let captionInput: HTMLInputElement | null = null;
// Uncommitted typed caption; null = trust the source. Preserved across the
// rebuild that an align/resize writeback triggers, so a half-typed caption
// isn't lost when the user nudges alignment or resizes mid-type.
let pendingCaption: string | null = null;
let inCommit = false; // re-entrancy guard: dispatch removes the old input, firing blur synchronously
let drag: {
  pointerId: number;
  handle: HTMLElement;
  spec: HandleSpec;
  startX: number;
  startY: number;
  startW: number;
  ratio: number;
  maxW: number;
} | null = null;

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
  const dataFrom = Number(figure.dataset.imageFrom);
  const dataTo = Number(figure.dataset.imageTo);
  if (Number.isInteger(dataFrom) && Number.isInteger(dataTo) &&
      dataFrom >= 0 && dataTo > dataFrom && dataTo <= view.state.doc.length) {
    const raw = view.state.doc.sliceString(dataFrom, dataTo);
    if (parseImage(raw)) return { from: dataFrom, to: dataTo, raw };
  }
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

/** Current attrs, with caption sourced from `pendingCaption` (uncommitted
 *  typed value) when present so a mid-type caption survives align/resize
 *  writes that rebuild the widget. */
function currentAttrs(): ImageAttrs {
  if (!active) return { caption: "", url: "", width: null, align: null };
  const parsed = parseImage(active.raw) ?? { caption: "", url: "", width: null, align: null };
  const caption = pendingCaption != null ? pendingCaption : parsed.caption;
  return { ...parsed, caption };
}

/** After a writeback, the preview plugin rebuilds the ImgWidget DOM, destroying
 *  the figure that hosted the overlays. Re-find the rebuilt figure for THIS
 *  image via the exact `data-image-from` carried by its widget rather than by
 *  caption — duplicate empty captions made caption matching attach to the
 *  wrong figure. If the widget is torn down or the image is in source mode,
 *  the data-position lookup has no match and the toolbar closes. */
function reattach(view: EditorView): void {
  if (!active || !toolbarEl || !handlesEl || !captionInput) return;
  const figure = view.dom.querySelector(
    `.cm-preview-figure[data-image-from="${active.from}"]`,
  ) as HTMLElement | null;
  if (!figure) {
    closeToolbar();
    return;
  }
  active.figure = figure;
  figure.classList.add("cm-img-editing");

  const wrap = figure.querySelector(".cm-img-wrap") as HTMLElement | null;
  if (wrap) {
    wrap.classList.add("cm-img-active");
    wrap.appendChild(handlesEl);
    wrap.appendChild(toolbarEl); // absolutely positioned → floats above image
  }

  const parsed = parseImage(active.raw);
  captionInput.value = pendingCaption != null ? pendingCaption : parsed?.caption ?? "";
  // Size the caption input to the image width so it sits directly under the
  // image at its horizontal extent (align-items centers/rights it with the img).
  const img = figure.querySelector("img") as HTMLImageElement | null;
  if (img) captionInput.style.width = `${img.offsetWidth || img.clientWidth || 120}px`;

  const resolvedAlign = parsed?.align ?? "left";
  for (const button of toolbarEl.querySelectorAll<HTMLButtonElement>("button[data-align]")) {
    button.setAttribute("aria-pressed", String(button.dataset.align === resolvedAlign));
  }

  // Flip the toolbar below the image when there's no room above (image at the
  // top of the scroll viewport) so it isn't clipped by the editor bounds.
  const figTop = figure.getBoundingClientRect().top;
  const viewTop = view.dom.getBoundingClientRect().top;
  toolbarEl.classList.toggle("cm-img-toolbar-below", figTop - viewTop < 40);

  const content = figure.querySelector(".cm-img-content") as HTMLElement | null;
  content?.appendChild(captionInput); // sibling of the image wrap, outside its selection border
}

/** True if `t` is inside any active overlay — clicks there must not re-open or
 *  close the toolbar. */
function isOverlayTarget(t: HTMLElement | null): boolean {
  return !!t && (!!toolbarEl?.contains(t) || !!handlesEl?.contains(t) || t === captionInput);
}

function buildAlignButton(al: ImageAlign, label: string, icon: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.align = al;
  b.setAttribute("aria-label", label);
  b.title = label;
  b.appendChild(createIcon({ phosphor: `ph ${icon}`, size: 16 }));
  // Prevent mousedown from moving focus out of the caption input (which would
  // blur-commit-close and eat the align click). Focus stays in the input;
  // pendingCaption carries the in-progress caption through the write.
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.onclick = (e) => {
    e.stopPropagation();
    if (!active) return;
    const cur = currentAttrs();
    const nextAlign: ImageAlign | null = cur.align === al ? null : al;
    writeSource({ ...cur, align: nextAlign });
    reattach(active.view);
  };
  return b;
}

function buildToolbar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "cm-img-toolbar";
  bar.appendChild(buildAlignButton("left", "图片左对齐", "ph-align-left"));
  bar.appendChild(buildAlignButton("center", "图片居中", "ph-align-center-horizontal"));
  bar.appendChild(buildAlignButton("right", "图片右对齐", "ph-align-right"));
  return bar;
}

function buildHandles(): HTMLElement {
  const container = document.createElement("div");
  container.className = "cm-img-handles";
  for (const spec of HANDLE_SPECS) {
    const h = document.createElement("div");
    h.className = `cm-img-handle cm-img-handle-${spec.id}`;
    h.style.cursor = spec.cursor;
    h.addEventListener("pointerdown", onHandlePointerDown(spec));
    container.appendChild(h);
  }
  // move/up live on the container; setPointerCapture on the handle retargets
  // captured pointer events to the handle, which bubble up to the container.
  container.addEventListener("pointermove", onHandlePointerMove);
  container.addEventListener("pointerup", onHandlePointerUp);
  container.addEventListener("pointercancel", onHandlePointerUp);
  return container;
}

function buildCaptionInput(caption: string): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = "cm-img-caption-input";
  input.placeholder = "添加图注…";
  input.value = caption;
  // No per-keystroke source write — that would rebuild the widget and destroy
  // the input mid-type. Live-update img.alt/figcaption for preview; commit on
  // blur/Enter.
  input.oninput = () => {
    if (!active) return;
    pendingCaption = input.value;
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
  input.onblur = () => {
    if (inCommit || !active) return;
    inCommit = true;
    const cur = currentAttrs();
    writeSource({ ...cur, caption: input.value });
    inCommit = false;
    closeToolbar();
  };
  return input;
}

function onHandlePointerDown(spec: HandleSpec) {
  return (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!active) return;
    const img = active.figure.querySelector("img") as HTMLImageElement | null;
    if (!img) return; // figure torn down
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    const ratio = nw && nh ? nw / nh : img.offsetWidth && img.offsetHeight ? img.offsetWidth / img.offsetHeight : 1;
    drag = {
      pointerId: e.pointerId,
      handle: e.currentTarget as HTMLElement,
      spec,
      startX: e.clientX,
      startY: e.clientY,
      startW: img.offsetWidth,
      ratio,
      maxW: active.view.dom.clientWidth,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
}

function onHandlePointerMove(e: PointerEvent) {
  if (!drag || !active) return;
  const img = active.figure.querySelector("img") as HTMLImageElement | null;
  if (!img) {
    drag = null;
    return;
  }
  const wrap = active.figure.querySelector(".cm-img-wrap") as HTMLElement | null;
  const { width, tx, ty } = computeResize(drag.spec, {
    startW: drag.startW,
    dx: e.clientX - drag.startX,
    dy: e.clientY - drag.startY,
    ratio: drag.ratio,
    maxW: drag.maxW,
  });
  img.style.width = `${width}px`;
  if (wrap) wrap.style.transform = `translate(${tx}px, ${ty}px)`;
  if (captionInput) captionInput.style.width = `${width}px`;
}

function onHandlePointerUp() {
  if (!drag) return;
  const d = drag;
  drag = null;
  d.handle.releasePointerCapture?.(d.pointerId);
  if (!active) return;
  const img = active.figure.querySelector("img") as HTMLImageElement | null;
  const wrap = active.figure.querySelector(".cm-img-wrap") as HTMLElement | null;
  if (!img) return; // torn down mid-drag — abort, no commit
  if (wrap) wrap.style.transform = ""; // clear transform before the rebuild
  const w = Math.max(40, Math.min(Math.round(img.offsetWidth), d.maxW));
  const cur = currentAttrs();
  writeSource({ ...cur, width: w });
  reattach(active.view);
}

function openToolbar(view: EditorView, figure: HTMLElement): void {
  closeToolbar();
  const range = locateImageRange(view, figure);
  if (!range) return;
  const attrs = parseImage(range.raw) ?? { caption: "", url: "", width: null, align: null };
  active = { view, figure, from: range.from, to: range.to, raw: range.raw };
  pendingCaption = attrs.caption;

  toolbarEl = buildToolbar();
  handlesEl = buildHandles();
  captionInput = buildCaptionInput(attrs.caption);

  reattach(view);
}

function closeToolbar(): void {
  if (active) {
    active.figure.classList.remove("cm-img-editing");
    active.figure.querySelector(".cm-img-wrap")?.classList.remove("cm-img-active");
  }
  toolbarEl?.remove();
  handlesEl?.remove();
  captionInput?.remove();
  toolbarEl = null;
  handlesEl = null;
  captionInput = null;
  pendingCaption = null;
  inCommit = false;
  drag = null;
  active = null;
}

/** Wire toolbar open/close onto an editor view. Call once per editor. */
export function attachImageToolbar(view: EditorView): () => void {
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    // Clicks on any overlay (buttons / handles / caption) must not re-open or
    // close the toolbar — let their own handlers run.
    if (isOverlayTarget(target)) return;
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
    if (e.key === "Escape") {
      if (view.state.field(imageSourceField, false)) {
        e.preventDefault();
        view.dispatch({ effects: SetImageSourceEffect.of(null) });
      }
      closeToolbar();
      return;
    }
    if ((e.key === "F2" || e.key === "Enter") && active && e.target !== captionInput) {
      e.preventDefault();
      const { from, to, view: activeView } = active;
      closeToolbar();
      // Place the caret inside the image token. The preview range gate then
      // reveals Markdown while keeping adjacent lines outside the image range.
      activeView.dispatch({
        effects: SetImageSourceEffect.of({ from, to }),
        selection: { anchor: Math.min(from + 2, activeView.state.doc.length) },
      });
      activeView.focus();
    }
  };
  view.dom.addEventListener("click", onClick);
  // Capture keydown before CodeMirror's content handler. In particular Enter
  // must switch the selected image to source without first inserting a newline
  // at the previously active prose caret.
  view.dom.addEventListener("keydown", onKey, true);
  return () => {
    view.dom.removeEventListener("click", onClick);
    view.dom.removeEventListener("keydown", onKey, true);
    closeToolbar();
  };
}
