import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { syntaxTree } from "@codemirror/language";
import { StateEffect, type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { parseChips, readBidMarker, stripBidMarker, type Source } from "./quote";
import { stripTagMarker } from "./tags/model";

function getCursorLines(view: EditorView): Set<number> {
  const lines = new Set<number>();
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number;
    const b = view.state.doc.lineAt(r.to).number;
    for (let i = a; i <= b; i++) lines.add(i);
  }
  return lines;
}

class BulletWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.textContent = "•";
    return span;
  }
}

class HrWidget extends WidgetType {
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-preview-hr";
    return span;
  }
  ignoreEvent() { return true; }
}

class ImgWidget extends WidgetType {
  constructor(readonly url: string, readonly alt: string) { super(); }
  eq(o: ImgWidget): boolean { return o.url === this.url && o.alt === this.alt; }
  toDOM(): HTMLElement {
    const img = document.createElement("img");
    img.className = "cm-preview-img";
    img.alt = this.alt;
    img.src = /^https?:\/\//.test(this.url) ? this.url : convertFileSrc(this.url);
    return img;
  }
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

class TableWidget extends WidgetType {
  constructor(readonly src: string) { super(); }
  eq(o: TableWidget): boolean { return o.src === this.src; }
  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-preview-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-preview-table";
    let isHeader = true;
    for (const line of this.src.trim().split("\n")) {
      if (/^\s*\|?[\s\-:]+\|/.test(line)) { isHeader = false; continue; }
      const cells = line.replace(/^\||\|$/g, "").split("|");
      const tr = document.createElement("tr");
      for (const cell of cells) {
        const el = isHeader ? document.createElement("th") : document.createElement("td");
        el.textContent = cell.trim();
        tr.appendChild(el);
      }
      table.appendChild(tr);
    }
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent() { return true; }
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

function buildDecorations(view: EditorView): DecorationSet {
  const cursorLines = getCursorLines(view);
  const entries: Array<{ from: number; to: number; deco: Decoration }> = [];
  const hide = Decoration.replace({});
  const doc = view.state.doc;

  const onCursorLine = (pos: number) => cursorLines.has(doc.lineAt(pos).number);
  const lineStart = (pos: number) => doc.lineAt(pos).from;
  const charAfter = (pos: number) => doc.sliceString(pos, pos + 1);

  // First pass: collect the line numbers that belong to a `[!quote]` card so
  // the QuoteMark handler can skip the plain-blockquote style on those lines,
  // and so the card pass below knows each card's first/last line.
  const cardLines = new Set<number>();
  const cardFirstLine = new Set<number>();
  const cardLastLine = new Map<number, number>(); // firstLine -> lastLine
  for (let pos = view.viewport.from; pos <= view.viewport.to && pos <= doc.length; ) {
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

  syntaxTree(view.state).iterate({
    from: view.viewport.from,
    to: view.viewport.to,
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
          if (onCursorLine(node.from)) return false;
          entries.push({ from: node.from, to: node.to, deco: hide });
          return false;
        }

        case "CodeMark": {
          if (onCursorLine(node.from)) return false;
          entries.push({ from: node.from, to: node.to, deco: hide });
          return false;
        }

        case "InlineCode": {
          if (onCursorLine(node.from)) return false;
          entries.push({
            from: node.from,
            to: node.to,
            deco: Decoration.mark({ class: "cm-preview-inline-code" }),
          });
          return; // visit children to hide CodeMark
        }

        case "QuoteMark": {
          if (onCursorLine(node.from)) return false;
          let end = node.to;
          if (charAfter(end) === " ") end++;
          entries.push({ from: node.from, to: end, deco: hide });
          // Card lines get the card frame classes (added in the card pass below),
          // so skip the plain-blockquote line style for them.
          if (!cardLines.has(doc.lineAt(node.from).number)) {
            entries.push({
              from: lineStart(node.from),
              to: lineStart(node.from),
              deco: Decoration.line({ class: "cm-preview-blockquote" }),
            });
          }
          return false;
        }

        case "ListMark": {
          if (onCursorLine(node.from)) return false;
          const ch = doc.sliceString(node.from, node.to);
          if (ch === "-" || ch === "*" || ch === "+") {
            entries.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({ widget: new BulletWidget() }),
            });
          }
          return false;
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
          const alt = raw.match(/!\[([^\]]*)\]/)?.[1] ?? "";
          const url = raw.match(/\(([^)]+)\)/)?.[1].trim() ?? "";
          if (url) {
            entries.push({
              from: node.from,
              to: node.to,
              deco: Decoration.replace({ widget: new ImgWidget(url, alt) }),
            });
          }
          return false;
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
          const fromLine = doc.lineAt(node.from).number;
          const toLine = doc.lineAt(node.to).number;
          for (let l = fromLine; l <= toLine; l++) {
            if (cursorLines.has(l)) return false;
          }
          const src = doc.sliceString(node.from, node.to);
          entries.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({ widget: new TableWidget(src), block: true }),
          });
          return false;
        }
      }
    },
  });

  // Callout marker — `> [!quote] …`. The lezer markdown grammar treats `[!type]`
  // as plain text inside the blockquote, so hide it line-by-line: the `> ` is
  // already removed by QuoteMark above, here we drop the `[!type] ` token so only
  // the body reads through (minimal rendering, no boxes). Skip the cursor line so
  // editing the marker stays possible.
  for (let pos = view.viewport.from; pos <= view.viewport.to; ) {
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
      if (l < view.viewport.from || l > view.viewport.to) continue;
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
    if (titleLine.from >= view.viewport.from && titleLine.to <= view.viewport.to &&
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

const previewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      const iconReady = u.transactions.some((tr) =>
        tr.effects.some((e) => e.is(IconReadyEffect)));
      if (u.docChanged || u.viewportChanged || u.selectionSet || iconReady) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

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
  ".cm-preview-img": {
    maxWidth: "100%",
    borderRadius: "4px",
    display: "inline-block",
    verticalAlign: "middle",
    margin: "2px 0",
  },
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
  },
  ".cm-preview-table th": { fontWeight: "600", background: "rgba(0,0,0,0.04)" },
});

export function livePreview(): Extension[] {
  return [previewPlugin, previewTheme];
}
