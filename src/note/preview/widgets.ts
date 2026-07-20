import { EditorView, WidgetType } from "@codemirror/view";
import { parseChips, type Source } from "../quote";
import { renderInline } from "../inline";
import { parseGfmTableOffsets, type Align, type CellRange } from "../table";
import { parseImage, type ImageAlign } from "../image-attrs";
import { imageSrc } from "../image-fs";
import { ensureIcon } from "./icons";
import { wireOpenUrlLink } from "../../platform/open-url";
import { isListFolded } from "../list-fold";

function applyFoldTarget(marker: HTMLElement, view: EditorView, id: string | null): void {
  marker.classList.toggle("cm-list-fold-marker", id !== null);
  marker.classList.toggle("cm-list-fold-marker-folded", id !== null && isListFolded(view.state, id));
  if (id) marker.dataset.listFoldId = id;
  else delete marker.dataset.listFoldId;
}

class BulletWidget extends WidgetType {
  constructor(readonly foldTargetId: string | null = null) { super(); }
  eq(other: BulletWidget): boolean { return other.foldTargetId === this.foldTargetId; }
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-list-leaf-dot";
    span.setAttribute("aria-hidden", "true");
    applyFoldTarget(span, view, this.foldTargetId);
    return span;
  }
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    applyFoldTarget(dom, view, this.foldTargetId);
    return true;
  }
}

/** Ordered-list marker: shows the ordinal computed from the list tree instead
 *  of the literal source digits, so indent/outdent re-numbers automatically.
 *  Keeps the user's delimiter (`.` or `)`). */
class OlNumberWidget extends WidgetType {
  constructor(
    readonly ordinal: number,
    readonly delim: string,
    readonly foldTargetId: string | null = null,
  ) { super(); }
  eq(o: OlNumberWidget): boolean {
    return o.ordinal === this.ordinal && o.delim === this.delim &&
      o.foldTargetId === this.foldTargetId;
  }
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-preview-ol-mark";
    const number = document.createElement("span");
    number.className = "cm-preview-ol-number";
    number.textContent = String(this.ordinal);
    const delim = document.createElement("span");
    delim.className = "cm-preview-ol-delim";
    delim.textContent = this.delim;
    span.append(number, delim);
    applyFoldTarget(span, view, this.foldTargetId);
    return span;
  }
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const number = dom.querySelector<HTMLElement>(".cm-preview-ol-number");
    const delim = dom.querySelector<HTMLElement>(".cm-preview-ol-delim");
    if (!number || !delim) return false;
    number.textContent = String(this.ordinal);
    delim.textContent = this.delim;
    applyFoldTarget(dom, view, this.foldTargetId);
    return true;
  }
  ignoreEvent() { return true; }
}

class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-preview-hr";
    return span;
  }
  ignoreEvent() { return true; }
}

/** Per-editor note directory, set by editor.ts so ImgWidget can resolve
 *  relative `./_assets/...` paths into floatnote-img:// URLs. Keyed by the
 *  EditorView's DOM root so the inbox and piece editors don't collide. */
const noteDirs = new WeakMap<HTMLElement, string>();
export function setNoteDir(view: EditorView, dir: string): void {
  noteDirs.set(view.dom, dir);
}
function noteDirOf(view: EditorView): string {
  return noteDirs.get(view.dom) ?? "";
}

class ImgWidget extends WidgetType {
  constructor(readonly raw: string, readonly from: number, readonly to: number) { super(); }
  eq(o: ImgWidget): boolean { return o.raw === this.raw && o.from === this.from && o.to === this.to; }
  toDOM(view: EditorView): HTMLElement {
    const a = parseImage(this.raw);
    const figure = document.createElement("figure");
    const align: ImageAlign = a?.align ?? "left";
    figure.className = `cm-preview-figure img-${align}`;
    figure.dataset.imageFrom = String(this.from);
    figure.dataset.imageTo = String(this.to);
    const img = document.createElement("img");
    img.className = "cm-preview-img";
    img.alt = a?.caption ?? "";
    const url = a?.url ?? "";
    img.src = imageSrc(url, noteDirOf(view));
    img.style.width = a?.width ? `${a.width}px` : "";
    // cm-img-wrap is a tight positioning context around the image only: the
    // active toolbar (floating above) and the 8 resize handles are absolutely
    // positioned against this box. line-height:0 lets the inline-block hug the
    // img with no descender gap so handles align to the image edges exactly.
    const wrap = document.createElement("div");
    wrap.className = "cm-img-wrap";
    wrap.appendChild(img);
    const content = document.createElement("div");
    content.className = "cm-img-content";
    content.appendChild(wrap);
    figure.appendChild(content);
    if (a && a.caption) {
      const fig = document.createElement("figcaption");
      fig.className = "cm-preview-figcaption";
      fig.textContent = a.caption;
      content.appendChild(fig);
    }
    // Mirror CheckboxWidget's mousedown + preventDefault so CodeMirror doesn't
    // move the cursor onto this line (which would tear the widget down via the
    // onCursorLine gate) before the subsequent click can open the toolbar. The
    // active overlays (toolbar / handles / caption input) must NOT be
    // preventDefaulted so handles drag, the input focuses, and buttons click.
    figure.addEventListener("mousedown", (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".cm-img-toolbar, .cm-img-handles, .cm-img-caption-input")) return;
      e.preventDefault();
    });
    return figure;
  }
  ignoreEvent(event: Event): boolean {
    const target = event.target;
    return target instanceof Element && !!target.closest(
      ".cm-img-toolbar, .cm-img-handles, .cm-img-caption-input",
    );
  }
}

class LinkWidget extends WidgetType {
  constructor(readonly text: string, readonly url: string) { super(); }
  eq(o: LinkWidget): boolean { return o.url === this.url && o.text === this.text; }
  toDOM(): HTMLElement {
    const a = document.createElement("a");
    a.className = "cm-preview-link";
    a.textContent = this.text;
    a.title = this.url;
    wireOpenUrlLink(a, this.url);
    return a;
  }
  // Eat clicks on the link so the editor doesn't drop the cursor onto the raw
  // `[text](url)` source.
  ignoreEvent() { return true; }
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly markFrom: number,
    readonly markTo: number,
  ) { super(); }
  eq(o: CheckboxWidget): boolean {
    return o.checked === this.checked && o.markFrom === this.markFrom;
  }
  toDOM(view: EditorView): HTMLElement {
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "cm-preview-checkbox";
    cb.checked = this.checked;
    cb.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({
        changes: {
          from: this.markFrom,
          to: this.markTo,
          insert: this.checked ? "[ ]" : "[x]",
        },
      });
    });
    return cb;
  }
  ignoreEvent() { return false; }
}

/**
 * GFM table, rendered for reading. Clicking a cell dispatches the CodeMirror
 * caret to that cell's source offset (tracked via the offset-aware parser),
 * which trips the Table cursor-line reveal gate below — the table source then
 * shows with the caret inside the clicked cell, ready to edit. Click away and
 * the rendered table returns.
 *
 * Why not WYSIWYG typing inside the cells: CodeMirror's DOMObserver listens to
 * `beforeinput`/`input` on contentDOM in the CAPTURE phase, so it reads DOM
 * changes from anywhere in the editor — including a nested contenteditable
 * cell — and maps them to document positions inside the table's replaced
 * range, corrupting the source. Capture-phase listeners can't be preempted
 * from a descendant, so editable-in-widget cells aren't viable in CM6. The
 * offset model in table.ts is kept so this click-to-locate path is precise.
 */
class TableWidget extends WidgetType {
  constructor(readonly src: string, readonly base: number) { super(); }
  eq(o: TableWidget): boolean { return o.src === this.src; }

  private buildCell(tag: "th" | "td", cell: CellRange, align: Align, view: EditorView): HTMLElement {
    const el = document.createElement(tag);
    el.style.textAlign = align === "none" ? "" : align;
    el.innerHTML = renderInline(cell.text);
    // Click a cell → caret at that cell's source span → reveal gate fires.
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.base + cell.from } });
    });
    return el;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-preview-table-wrap";
    const parsed = parseGfmTableOffsets(this.src);
    if (!parsed) { wrap.textContent = this.src; return wrap; }
    const table = document.createElement("table");
    table.className = "cm-preview-table";

    const thead = document.createElement("thead");
    const htr = document.createElement("tr");
    parsed.header.forEach((cell, i) => {
      htr.appendChild(this.buildCell("th", cell, parsed.aligns[i] ?? "none", view));
    });
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of parsed.rows) {
      const tr = document.createElement("tr");
      row.forEach((cell, i) => {
        tr.appendChild(this.buildCell("td", cell, parsed.aligns[i] ?? "none", view));
      });
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  // Widget owns the mousedown (to dispatch the caret); other events fall
  // through harmlessly.
  ignoreEvent() { return false; }
}

class QuoteCardWidget extends WidgetType {
  // `iconCached` flips false→true exactly once, when the async icon fetch
  // resolves and the plugin rebuilds; that makes `eq` return false once, so CM
  // re-runs toDOM and the cached data-URI is finally rendered. Without it, CM
  // would keep the icon-less DOM forever (eq true) and the icon never appears.
  constructor(
    readonly chipsStr: string,
    readonly bundleId: string | null,
    readonly iconStateKey: string,
  ) { super(); }
  eq(o: QuoteCardWidget): boolean {
    return o.chipsStr === this.chipsStr &&
      o.bundleId === this.bundleId &&
      o.iconStateKey === this.iconStateKey;
  }
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-quote-card-chips";
    if (this.bundleId) {
      const icon = ensureIcon(view, this.bundleId);
      if (icon) {
        const img = document.createElement("img");
        img.className = "cm-quote-card-icon";
        img.src = icon;
        img.alt = "";
        span.appendChild(img);
      }
    }
    const chips: Source[] = parseChips(this.chipsStr);
    chips.forEach((c, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "cm-quote-card-sep";
        sep.textContent = "·";
        span.appendChild(sep);
      }
      if (c.kind === "web" && c.url) {
        const a = document.createElement("a");
        a.className = "cm-quote-card-link";
        a.title = `${c.title}\n${c.url}`;
        a.textContent = c.title;
        wireOpenUrlLink(a, c.url);
        span.appendChild(a);
      } else {
        const s = document.createElement("span");
        s.className = "cm-quote-card-app";
        s.title = c.title;
        s.textContent = c.title;
        span.appendChild(s);
      }
    });
    return span;
  }
  // Eat clicks on the link so the editor doesn't drop the cursor onto the card
  // line (which would reveal the raw `> [!quote]` source). Clicks on other parts
  // of the card keep the existing click-to-reveal-raw behaviour.
  ignoreEvent(event: Event): boolean {
    const t = event.target as HTMLElement | null;
    return !!t && !!t.closest && !!t.closest(".cm-quote-card-link");
  }
}

export {
  BulletWidget,
  OlNumberWidget,
  HrWidget,
  ImgWidget,
  LinkWidget,
  CheckboxWidget,
  TableWidget,
  QuoteCardWidget,
};
