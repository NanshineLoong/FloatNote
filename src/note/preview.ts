import { invoke } from "@tauri-apps/api/core";
import { syntaxTree } from "@codemirror/language";
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  RangeSetBuilder,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
} from "@codemirror/view";
import { parseChips, readBidMarker, stripBidMarker, type Source } from "./quote";
import { isSafeUrl, renderInline } from "./inline";
import { parseGfmTableOffsets, type Align, type CellRange } from "./table";
import { stripTagMarker } from "@floatnote/note-logic";
import { parseImage, type ImageAlign } from "./image-attrs";
import { imageSrc } from "./image-fs";
import { olOrdinal } from "./list-indent";

function getCursorLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let i = a; i <= b; i++) lines.add(i);
  }
  return lines;
}

/** True iff any selection range touches the inline mark [from,to].
 *  - A bare cursor at p touches when `from <= p <= to` (inclusive both edges,
 *    so placing the cursor on/approaching a mark reveals it for editing).
 *  - A non-empty selection [s.from, s.to) touches when it actually overlaps
 *    the mark's interior (strict half-open: `s.from < to && s.to > from`) —
 *    a selection merely adjacent to a mark edge does not reveal it.
 *  This is the Obsidian live-preview granularity, as opposed to the
 *  whole-cursor-line reveal used for block widgets. */
export function rangeTouchesSelection(
  ranges: readonly { from: number; to: number }[],
  from: number,
  to: number,
): boolean {
  for (const r of ranges) {
    if (r.from === r.to) {
      if (r.from >= from && r.from <= to) return true;
    } else if (r.from < to && r.to > from) {
      return true;
    }
  }
  return false;
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.textContent = "•";
    return span;
  }
}

/** Ordered-list marker: shows the ordinal computed from the list tree (via
 *  olOrdinal) instead of the literal source digits, so indent/outdent
 *  re-numbers automatically. Keeps the user's delimiter (`.` or `)`). */
class OlNumberWidget extends WidgetType {
  constructor(readonly ordinal: number, readonly delim: string) { super(); }
  eq(o: OlNumberWidget): boolean { return o.ordinal === this.ordinal && o.delim === this.delim; }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-preview-ol-mark";
    span.textContent = `${this.ordinal}${this.delim}`;
    return span;
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
  constructor(readonly raw: string) { super(); }
  eq(o: ImgWidget): boolean { return o.raw === this.raw; }
  toDOM(view: EditorView): HTMLElement {
    const a = parseImage(this.raw);
    const figure = document.createElement("figure");
    const align: ImageAlign = a?.align ?? "left";
    figure.className = `cm-preview-figure img-${align}`;
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
    figure.appendChild(wrap);
    if (a && a.caption) {
      const fig = document.createElement("figcaption");
      fig.className = "cm-preview-figcaption";
      fig.textContent = a.caption;
      figure.appendChild(fig);
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
  ignoreEvent() { return false; } // allow clicks for the toolbar (Task 7)
}

class LinkWidget extends WidgetType {
  constructor(readonly text: string, readonly url: string) { super(); }
  eq(o: LinkWidget): boolean { return o.url === this.url && o.text === this.text; }
  toDOM(): HTMLElement {
    const a = document.createElement("a");
    a.className = "cm-preview-link";
    a.textContent = this.text;
    a.title = this.url;
    // Real href for status-bar/aria; navigation is routed through `open_url`
    // because the webview blocks external navigation by default.
    a.href = this.url;
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void invoke("open_url", { url: this.url });
    });
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

// ── App-icon cache ─────────────────────────────────────────────────────────
// `app_icon(bundleId)` is a Tauri command returning a `data:image/png;base64,…`
// string (or null). QuoteCardWidget.toDOM is synchronous, so on a cache miss we
// kick off the fetch and dispatch IconReadyEffect when it resolves; the plugin
// rebuilds and the widget re-paints with the cached data-URI on its next toDOM.
// One process-wide cache keyed by bundle id; icons are stable per installed app.
const iconCache = new Map<string, string | null>();
const iconFailureAt = new Map<string, number>();
const iconPending = new Set<string>();
const iconRetryTimers = new Map<string, number>();
let iconView: EditorView | null = null;
const ICON_RETRY_MS = 30_000;

export function shouldRetryMissingIcon(
  failedAt: number | undefined,
  now: number,
  retryMs = ICON_RETRY_MS,
): boolean {
  return failedAt === undefined || now - failedAt >= retryMs;
}

export function iconCacheStateKey(
  hasCacheEntry: boolean,
  cached: string | null | undefined,
  failedAt: number | undefined,
): string {
  if (cached) return "ready";
  if (hasCacheEntry) return `missing:${failedAt ?? 0}`;
  return "empty";
}

function dispatchIconReady(): void {
  const v = iconView;
  if (v) queueMicrotask(() => v.dispatch({ effects: IconReadyEffect.of(0) }));
}

function scheduleIconRetry(bundleId: string): void {
  if (iconRetryTimers.has(bundleId)) return;
  const timer = window.setTimeout(() => {
    iconRetryTimers.delete(bundleId);
    if (iconCache.get(bundleId) === null) {
      iconCache.delete(bundleId);
      iconFailureAt.delete(bundleId);
      dispatchIconReady();
    }
  }, ICON_RETRY_MS);
  iconRetryTimers.set(bundleId, timer);
}

/** Emitted to self when an icon fetch resolves so the plugin rebuilds. */
const IconReadyEffect = StateEffect.define<number>();

/** Return the cached icon data-URI for `bundleId`, or null if not yet available
 *  (a fetch is started on a miss). `view` is remembered for the async callback. */
function ensureIcon(view: EditorView, bundleId: string): string | null {
  iconView = view;
  if (iconCache.has(bundleId)) {
    const cached = iconCache.get(bundleId) ?? null;
    if (cached) return cached;
    if (!shouldRetryMissingIcon(iconFailureAt.get(bundleId), Date.now())) {
      return null;
    }
    iconCache.delete(bundleId);
    iconFailureAt.delete(bundleId);
  }
  if (iconPending.has(bundleId)) return null;
  iconPending.add(bundleId);
  void invoke<string | null>("app_icon", { bundleId })
    .then((dataUri) => {
      iconCache.set(bundleId, dataUri ?? null);
      if (dataUri) {
        iconFailureAt.delete(bundleId);
      } else {
        iconFailureAt.set(bundleId, Date.now());
        scheduleIconRetry(bundleId);
      }
    })
    .catch(() => {
      iconCache.set(bundleId, null);
      iconFailureAt.set(bundleId, Date.now());
      scheduleIconRetry(bundleId);
    })
    .finally(() => {
      iconPending.delete(bundleId);
      // Defer: toDOM runs mid-decoration-build; dispatching synchronously could
      // re-enter the plugin. A microtask lets the current build finish first.
      dispatchIconReady();
    });
  return null;
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
        // Real href for status-bar/aria; navigation is blocked in the click
        // handler and routed through the `open_url` Tauri command (the webview
        // blocks external navigation by default).
        a.href = c.url;
        a.title = `${c.title}\n${c.url}`;
        a.textContent = c.title;
        a.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          void invoke("open_url", { url: c.url });
        });
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

function buildDecorations(state: EditorState): DecorationSet {
  const cursorLines = getCursorLines(state);
  const selRanges = state.selection.ranges;
  const entries: Array<{ from: number; to: number; deco: Decoration }> = [];
  const hide = Decoration.replace({});
  const doc = state.doc;
  // Live-preview decorations include block widgets (tables, code blocks) and
  // line-break-spanning replacements, which CodeMirror only permits from a
  // StateField — never a ViewPlugin. StateFields have no viewport, so we walk
  // the whole document; note-sized files make this cheap and it keeps block
  // widgets stable across scrolling instead of flickering at viewport edges.
  const vpFrom = 0;
  const vpTo = doc.length;

  const onCursorLine = (pos: number) => cursorLines.has(doc.lineAt(pos).number);
  /** Inline-mark gate: hide/replace unless the cursor touches [from,to]. */
  const touches = (from: number, to: number) => rangeTouchesSelection(selRanges, from, to);
  const lineStart = (pos: number) => doc.lineAt(pos).from;
  const charAfter = (pos: number) => doc.sliceString(pos, pos + 1);

  /** Nesting depth of a ListItem = number of ListItem ancestors. Top-level → 0. */
  const listDepth = (node: { node: { parent: { name: string; parent: unknown } | null } }): number => {
    let depth = 0;
    let p = node.node.parent as { name: string; parent: unknown } | null;
    while (p) {
      if (p.name === "ListItem") depth++;
      p = (p.parent as { name: string; parent: unknown } | null) ?? null;
    }
    return depth;
  };

  /** line number → deepest ListItem nesting covering that line. Filled while
   *  iterating ListItems; applied as a single line decoration per line so we
   *  don't rely on multi-line-decoration merge semantics for nested items. */
  const listLineDepth = new Map<number, number>();

  // First pass: collect the line numbers that belong to a `[!quote]` card so
  // the QuoteMark handler can skip the plain-blockquote style on those lines,
  // and so the card pass below knows each card's first/last line.
  const cardLines = new Set<number>();
  const cardFirstLine = new Set<number>();
  const cardLastLine = new Map<number, number>(); // firstLine -> lastLine
  for (let pos = vpFrom; pos <= vpTo && pos <= doc.length; ) {
    const line = doc.lineAt(pos);
    const startMatch = /^(>\s*)\[!quote\]/.exec(line.text);
    if (startMatch) {
      cardFirstLine.add(line.number);
      cardLines.add(line.number);
      let end = line;
      while (end.number < doc.lines && end.to + 1 <= doc.length &&
        doc.lineAt(end.to + 1).text.startsWith(">")) {
        end = doc.lineAt(end.to + 1);
        cardLines.add(end.number);
      }
      cardLastLine.set(line.number, end.number);
      pos = end.to + 1;
    } else {
      pos = line.to + 1;
    }
  }

  syntaxTree(state).iterate({
    from: vpFrom,
    to: vpTo,
    enter(node) {
      switch (node.name) {
        case "ATXHeading1":
        case "ATXHeading2":
        case "ATXHeading3":
        case "ATXHeading4":
        case "ATXHeading5":
        case "ATXHeading6": {
          if (onCursorLine(node.from)) return false;
          const level = parseInt(node.name.slice(-1));
          entries.push({
            from: lineStart(node.from),
            to: lineStart(node.from),
            deco: Decoration.line({ class: `cm-preview-h${level}` }),
          });
          return; // visit children to hide HeaderMark
        }

        case "HeaderMark": {
          if (onCursorLine(node.from)) return false;
          let end = node.to;
          if (charAfter(end) === " ") end++;
          entries.push({ from: node.from, to: end, deco: hide });
          return false;
        }

        case "EmphasisMark":
        case "StrikethroughMark": {
          if (touches(node.from, node.to)) return false;
          entries.push({ from: node.from, to: node.to, deco: hide });
          return false;
        }

        case "CodeMark": {
          if (touches(node.from, node.to)) return false;
          entries.push({ from: node.from, to: node.to, deco: hide });
          return false;
        }

        case "CodeInfo": {
          // The fenced-code language identifier. Style it as a muted label but
          // keep it editable text (mark, not replace) so the user can change the
          // language. The surrounding fence (```/```) is hidden by CodeMark.
          entries.push({
            from: node.from,
            to: node.to,
            deco: Decoration.mark({ class: "cm-code-lang-text" }),
          });
          return false;
        }

        case "InlineCode": {
          // Always style the code text; the backticks (CodeMark) reveal only
          // when the cursor touches them. Keeps inline code styled even on the
          // cursor line (Obsidian behaviour).
          entries.push({
            from: node.from,
            to: node.to,
            deco: Decoration.mark({ class: "cm-preview-inline-code" }),
          });
          return; // visit children to hide CodeMark
        }

        case "QuoteMark": {
          const lineNo = doc.lineAt(node.from).number;
          const isCardLine = cardLines.has(lineNo);
          // Card lines keep the whole-line reveal so `>`, `[!quote]`, and the
          // chips widget stay consistent when the cursor is on the title line.
          if (isCardLine ? onCursorLine(node.from) : touches(node.from, node.to)) {
            return false;
          }
          let end = node.to;
          if (charAfter(end) === " ") end++;
          entries.push({ from: node.from, to: end, deco: hide });
          // Card lines get the card frame classes (added in the card pass below),
          // so skip the plain-blockquote line style for them.
          if (!isCardLine) {
            entries.push({
              from: lineStart(node.from),
              to: lineStart(node.from),
              deco: Decoration.line({ class: "cm-preview-blockquote" }),
            });
          }
          return false;
        }

        case "ListMark": {
          if (touches(node.from, node.to)) return false;
          const ch = doc.sliceString(node.from, node.to);
          if (ch === "-" || ch === "*" || ch === "+") {
            entries.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({ widget: new BulletWidget() }),
            });
          } else {
            // Ordered list marker (`1.`, `2.` …): replace the literal digits
            // with a widget that shows the ordinal computed from the list tree,
            // so indent/outdent re-numbers automatically. Source digits are
            // preserved (saved file keeps what the user typed).
            const raw = doc.sliceString(node.from, node.to);
            const delim = raw.replace(/^\d+/, ""); // "." | ")" — keep user delimiter
            entries.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({ widget: new OlNumberWidget(olOrdinal(node.node), delim) }),
            });
          }
          return false;
        }

        case "ListItem": {
          // Record nesting depth per line (max wins for lines shared with an
          // enclosing item); the line decorations are applied after the iterate
          // pass so nested items don't stack conflicting line styles.
          const depth = listDepth(node);
          const fromLine = doc.lineAt(node.from).number;
          const toLine = doc.lineAt(node.to).number;
          for (let l = fromLine; l <= toLine; l++) {
            if (l < vpFrom || l > vpTo) continue;
            const prev = listLineDepth.get(l);
            if (prev === undefined || depth > prev) listLineDepth.set(l, depth);
          }
          return; // visit children: ListMark, TaskMarker, …
        }

        case "HorizontalRule": {
          if (onCursorLine(node.from)) return false;
          entries.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({ widget: new HrWidget() }),
          });
          return false;
        }

        case "Image": {
          if (onCursorLine(node.from)) return false;
          const raw = doc.sliceString(node.from, node.to);
          // lang-markdown's Image node covers `![alt](url)` but NOT the trailing
          // `{...}` attr block (it's plain text). Extend the replacement to
          // include a `{...}` immediately following so it is hidden too.
          let to = node.to;
          const after = doc.sliceString(node.to, node.to + 1);
          if (after === "{") {
            const line = doc.lineAt(node.to);
            const close = doc.sliceString(node.to, line.to).indexOf("}");
            if (close >= 0) to = node.to + close + 1;
          }
          const url = raw.match(/\(([^)]+)\)/)?.[1].trim() ?? "";
          if (url) {
            entries.push({
              from: node.from,
              to,
              deco: Decoration.replace({ widget: new ImgWidget(doc.sliceString(node.from, to)) }),
            });
          }
          return false;
        }

        case "Link": {
          if (touches(node.from, node.to)) return false;
          const raw = doc.sliceString(node.from, node.to);
          const text = raw.match(/\[([^\]]*)\]/)?.[1] ?? "";
          const url = raw.match(/\(([^)]+)\)/)?.[1].trim() ?? "";
          if (isSafeUrl(url)) {
            entries.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({ widget: new LinkWidget(text, url) }),
            });
          }
          return false;
        }

        case "URL": {
          // Bare URL produced by Lezer's Autolink extension (www./http/https/
          // mailto/xmpp). Trailing punctuation & unbalanced ')' are already
          // trimmed by the grammar, so the node range is exactly the URL.
          if (touches(node.from, node.to)) return false;
          const url = doc.sliceString(node.from, node.to);
          if (isSafeUrl(url)) {
            entries.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({ widget: new LinkWidget(url, url) }),
            });
          }
          return false;
        }

        case "Autolink": {
          // <url> syntax: node spans the angle brackets; the inner URL is a
          // child node. We slice the inner text and return false so iterate
          // does not descend into that child (which would double-decorate).
          if (touches(node.from, node.to)) return false;
          const url = doc.sliceString(node.from + 1, node.to - 1);
          if (isSafeUrl(url)) {
            entries.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({ widget: new LinkWidget(url, url) }),
            });
          }
          return false;
        }

        case "FencedCode": {
          // Keep the block editable: do NOT replace it with a block widget.
          // Instead style every line of the block with `cm-codeblock` (with
          // first/last variants so the grey rounded frame doesn't stack per
          // line), then let the child CodeMark/CodeInfo/CodeText cases handle
          // the rest. The body (`CodeText`) stays live editable text; a nested
          // language parser (registered in editor.ts via `codeLanguages`)
          // highlights it, so arrow keys, click, and selection all work natively.
          const fromLine = doc.lineAt(node.from).number;
          const toLine = doc.lineAt(node.to).number;
          entries.push({
            from: lineStart(node.from),
            to: lineStart(node.from),
            deco: Decoration.line({ class: "cm-codeblock cm-codeblock-first" }),
          });
          entries.push({
            from: lineStart(doc.line(toLine).from),
            to: lineStart(doc.line(toLine).from),
            deco: Decoration.line({ class: "cm-codeblock cm-codeblock-last" }),
          });
          for (let l = fromLine; l <= toLine; l++) {
            if (l === fromLine || l === toLine) continue;
            const cl = doc.line(l);
            entries.push({
              from: cl.from,
              to: cl.from,
              deco: Decoration.line({ class: "cm-codeblock" }),
            });
          }
          return; // visit children: CodeMark (hide fences), CodeInfo, CodeText
        }

        case "TaskMarker": {
          if (onCursorLine(node.from)) return false;
          const raw = doc.sliceString(node.from, node.to);
          const checked = /x/i.test(raw);
          entries.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({
              widget: new CheckboxWidget(checked, node.from, node.to),
            }),
          });
          return false;
        }

        case "Table": {
          // Reveal the whole table as source when the caret is on any of its
          // lines (so the clicked cell, whose offset the widget dispatched the
          // caret to, becomes editable text). Otherwise render the table.
          const fromLine = doc.lineAt(node.from).number;
          const toLine = doc.lineAt(node.to).number;
          for (let l = fromLine; l <= toLine; l++) {
            if (cursorLines.has(l)) return false;
          }
          const src = doc.sliceString(node.from, node.to);
          entries.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({ widget: new TableWidget(src, node.from), block: true }),
          });
          return false;
        }
      }
    },
  });

  // List line styling. `--list-depth` is still recorded (harmless) but no
  // longer drives padding: per-level indent comes solely from the 4-space
  // source whitespace CM6 renders, so visual level === source level and a
  // single Backspace unit retreats exactly one level. `cm-preview-list` gives
  // list lines a uniform `0.6em` marker-side baseline.
  for (const [lineNo, depth] of listLineDepth) {
    const cl = doc.line(lineNo);
    if (lineNo < vpFrom || lineNo > vpTo) continue;
    entries.push({
      from: cl.from,
      to: cl.from,
      deco: Decoration.line({
        class: "cm-preview-list",
        attributes: { style: `--list-depth:${depth}` },
      }),
    });
  }

  // Callout marker — `> [!quote] …`. The lezer markdown grammar treats `[!type]`
  // as plain text inside the blockquote, so hide it line-by-line: the `> ` is
  // already removed by QuoteMark above, here we drop the `[!type] ` token so only
  // the body reads through (minimal rendering, no boxes). Skip the cursor line so
  // editing the marker stays possible.
  for (let pos = vpFrom; pos <= vpTo; ) {
    const line = doc.lineAt(pos);
    const m = /^(>\s*)(\[!\w+\]\s?)/.exec(line.text);
    if (m && !cursorLines.has(line.number)) {
      const start = line.from + m[1].length;
      entries.push({ from: start, to: start + m[2].length, deco: hide });
    }
    pos = line.to + 1;
  }

  // `[!quote]` card frame + chip-row title widget. For every line of a card,
  // apply the card line background + left accent; first/last lines get rounded
  // corners. On the (non-cursor) title line, replace the chips portion with a
  // chip-row widget. The `> ` prefix is hidden by QuoteMark and the `[!quote] `
  // type marker is hidden by the callout-marker loop above, so the widget only
  // needs to cover the chips text itself — three adjacent, non-overlapping ranges.
  for (const firstLine of cardFirstLine) {
    const lastLine = cardLastLine.get(firstLine) ?? firstLine;
    for (let l = firstLine; l <= lastLine; l++) {
      const cl = doc.line(l);
      if (l < vpFrom || l > vpTo) continue;
      entries.push({
        from: cl.from,
        to: cl.from,
        deco: Decoration.line({ class: "cm-quote-card-line" }),
      });
      if (l === firstLine) {
        entries.push({
          from: cl.from,
          to: cl.from,
          deco: Decoration.line({ class: "cm-quote-card-first" }),
        });
      }
      if (l === lastLine) {
        entries.push({
          from: cl.from,
          to: cl.from,
          deco: Decoration.line({ class: "cm-quote-card-last" }),
        });
      }
    }

    // Title-line chip widget (skip cursor line so the raw marker stays editable).
    // m[1] = `> [!quote] ` (quote marker + type + optional space) — exactly the
    // text already hidden by QuoteMark + the callout-marker loop. m[2] = chips,
    // minus any trailing floatnote tag OR bid marker (stripped here so neither
    // reads as a chip nor overlaps the widget's replaced range; both markers are
    // hidden by the tag decoration plugin). The widget range ends at the chips'
    // length so it does not overlap the markers' own hide decorations.
    const titleLine = doc.line(firstLine);
    if (titleLine.from >= vpFrom && titleLine.to <= vpTo &&
        !cursorLines.has(firstLine)) {
      const m = /^(>\s*\[!quote\]\s?)(.*)$/.exec(titleLine.text);
      if (m) {
        const chipStart = titleLine.from + m[1].length;
        const chipsStr = stripBidMarker(stripTagMarker(m[2]));
        // The bid marker lives inline on the title line; read it from the whole
        // card block so the widget can fetch the app icon.
        const lastLineNo = cardLastLine.get(firstLine) ?? firstLine;
        const lastLine = doc.line(lastLineNo);
        const blockText = doc.sliceString(titleLine.from, lastLine.to);
        const bundleId = readBidMarker(blockText);
        const cachedIcon = bundleId ? iconCache.get(bundleId) : undefined;
        const iconStateKey = bundleId
          ? iconCacheStateKey(iconCache.has(bundleId), cachedIcon, iconFailureAt.get(bundleId))
          : "none";
        entries.push({
          from: chipStart,
          to: chipStart + chipsStr.length,
          deco: Decoration.replace({
            widget: new QuoteCardWidget(chipsStr, bundleId, iconStateKey),
          }),
        });
      }
    }
  }

  entries.sort((a, b) => a.from !== b.from ? a.from - b.from : a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, deco } of entries) {
    builder.add(from, to, deco);
  }
  return builder.finish();
}

export const previewField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(deco, tr) {
    const iconReady = tr.effects.some((e) => e.is(IconReadyEffect));
    if (tr.docChanged || tr.selection || iconReady) {
      return buildDecorations(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const previewTheme = EditorView.theme({
  ".cm-preview-h1": { fontSize: "2em", fontWeight: "700", lineHeight: "1.3" },
  ".cm-preview-h2": { fontSize: "1.6em", fontWeight: "700", lineHeight: "1.3" },
  ".cm-preview-h3": { fontSize: "1.3em", fontWeight: "600", lineHeight: "1.3" },
  ".cm-preview-h4": { fontSize: "1.1em", fontWeight: "600" },
  ".cm-preview-h5": { fontSize: "1em", fontWeight: "600" },
  ".cm-preview-h6": { fontSize: "0.9em", fontWeight: "600" },
  ".cm-preview-blockquote": {
    borderLeft: "3px solid #9ca3af",
    paddingLeft: "10px",
    color: "#6b7280",
    fontStyle: "italic",
  },
  ".cm-preview-inline-code": {
    background: "rgba(0,0,0,0.07)",
    borderRadius: "3px",
    padding: "0 3px",
    fontFamily: "ui-monospace, 'SF Mono', monospace",
    fontSize: "0.9em",
  },
  ".cm-preview-hr": {
    display: "inline-block",
    width: "100%",
    borderTop: "1px solid rgba(0,0,0,0.18)",
    verticalAlign: "middle",
  },
  ".cm-preview-figure": { display: "flex", flexDirection: "column", alignItems: "flex-start", margin: "6px 0" },
  ".cm-preview-figure.img-center": { alignItems: "center" },
  ".cm-preview-figure.img-right": { alignItems: "flex-end" },
  ".cm-preview-img": { maxWidth: "100%", borderRadius: "4px", display: "block" },
  ".cm-preview-figcaption": { fontSize: "0.85em", color: "#6b7280", marginTop: "2px" },
  ".cm-img-wrap": { position: "relative", display: "inline-block", lineHeight: "0" },
  ".cm-preview-checkbox": {
    marginRight: "4px",
    cursor: "pointer",
    verticalAlign: "middle",
  },
  ".cm-preview-table-wrap": { display: "inline-block", width: "100%", margin: "4px 0" },
  ".cm-preview-table": { borderCollapse: "collapse", width: "100%", fontSize: "0.95em" },
  ".cm-preview-table th, .cm-preview-table td": {
    border: "1px solid rgba(0,0,0,0.15)",
    padding: "4px 8px",
    textAlign: "left",
    cursor: "text",
    minWidth: "2em",
  },
  ".cm-preview-table th:focus, .cm-preview-table td:focus": {
    outline: "2px solid #3b82f6",
    outlineOffset: "-2px",
  },
  ".cm-preview-table th": { fontWeight: "600", background: "rgba(0,0,0,0.04)" },
  // Code blocks are now editable text (no widget): each line of the block
  // carries `cm-codeblock`, with `cm-codeblock-first`/`-last` rounding only the
  // top/bottom so the grey frame doesn't stack per line. The body stays live
  // text highlighted by the nested language parser; fences are hidden by the
  // CodeMark case, the language id is styled muted by CodeInfo.
  // NOTE: do NOT change the line's HEIGHT here — no font-size, no vertical
  // padding/margin. CM6 maps clicks via per-line measured heights; a code line
  // whose height differs from a prose line (different font-size or vertical
  // padding) drifts posAtCoords so clicks land too high. Keep the line at the
  // inherited 1em / 1.6 line-height; only background + horizontal padding +
  // monospace family + corner radius are safe.
  ".cm-codeblock": {
    background: "rgba(0,0,0,0.05)",
    fontFamily: "ui-monospace, 'SF Mono', monospace",
    paddingLeft: "12px",
    paddingRight: "12px",
  },
  ".cm-codeblock.cm-codeblock-first": {
    borderTopLeftRadius: "8px",
    borderTopRightRadius: "8px",
  },
  ".cm-codeblock.cm-codeblock-last": {
    borderBottomLeftRadius: "8px",
    borderBottomRightRadius: "8px",
  },
  ".cm-code-lang-text": {
    color: "rgba(0,0,0,0.4)",
    fontFamily: "ui-monospace, 'SF Mono', monospace",
    fontSize: "0.8em",
  },
  ".cm-preview-link": {
    color: "#2563eb",
    textDecoration: "underline",
    cursor: "pointer",
  },
  ".cm-preview-link:hover": { color: "#1d4ed8" },
  ".cm-preview-ol-mark": { color: "#374151", fontWeight: "600" },
  ".cm-preview-list": {
    paddingLeft: "0.6em",
    listStyleType: "none",
  },
  ".cm-preview-figure.cm-img-active": { outline: "2px solid #3b82f6", borderRadius: "4px" },
  ".cm-img-toolbar": {
    position: "absolute",
    top: "-34px",
    left: "50%",
    transform: "translateX(-50%)",
    display: "flex",
    gap: "4px",
    alignItems: "center",
    background: "rgba(255,255,255,0.95)",
    border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: "4px",
    padding: "2px 4px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
    zIndex: "5",
  },
  ".cm-img-toolbar.cm-img-toolbar-below": { top: "auto", bottom: "-34px" },
  ".cm-img-toolbar button": {
    border: "1px solid rgba(0,0,0,0.15)",
    borderRadius: "3px",
    background: "#fff",
    padding: "0 6px",
    cursor: "pointer",
  },
  ".cm-img-handles": { position: "absolute", inset: "0", pointerEvents: "none" },
  ".cm-img-handle": {
    position: "absolute",
    width: "10px",
    height: "10px",
    background: "#3b82f6",
    border: "1px solid #fff",
    borderRadius: "2px",
    pointerEvents: "auto",
  },
  ".cm-img-handle-e": { right: "-5px", top: "50%", marginTop: "-5px" },
  ".cm-img-handle-w": { left: "-5px", top: "50%", marginTop: "-5px" },
  ".cm-img-handle-s": { bottom: "-5px", left: "50%", marginLeft: "-5px" },
  ".cm-img-handle-n": { top: "-5px", left: "50%", marginLeft: "-5px" },
  ".cm-img-handle-se": { right: "-5px", bottom: "-5px" },
  ".cm-img-handle-sw": { left: "-5px", bottom: "-5px" },
  ".cm-img-handle-ne": { right: "-5px", top: "-5px" },
  ".cm-img-handle-nw": { left: "-5px", top: "-5px" },
  ".cm-img-caption-input": {
    border: "none",
    background: "transparent",
    outline: "none",
    boxShadow: "none",
    padding: "0",
    margin: "0",
    marginTop: "2px",
    fontSize: "0.85em",
    color: "#6b7280",
    fontFamily: "inherit",
    textAlign: "inherit",
    width: "120px",
  },
  ".cm-img-caption-input::placeholder": { color: "#9ca3af" },
  ".cm-img-caption-input:focus": { outline: "none" },
});

export function livePreview(): Extension[] {
  return [previewField, previewTheme];
}

export { attachImageToolbar } from "./image-toolbar";
