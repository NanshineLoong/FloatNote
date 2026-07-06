import { convertFileSrc } from "@tauri-apps/api/core";
import { syntaxTree } from "@codemirror/language";
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { parseChips, type Source } from "./quote";
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

class QuoteCardWidget extends WidgetType {
  constructor(readonly chipsStr: string) { super(); }
  eq(o: QuoteCardWidget): boolean { return o.chipsStr === this.chipsStr; }
  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-quote-card-chips";
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
        a.href = c.url;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = c.title;
        span.appendChild(a);
      } else {
        const s = document.createElement("span");
        s.className = "cm-quote-card-app";
        s.textContent = c.title;
        span.appendChild(s);
      }
    });
    return span;
  }
  ignoreEvent() { return false; }
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
    // minus any trailing floatnote tag marker (stripped here so it doesn't read
    // as a chip; the marker itself is hidden by the tag decoration plugin). The
    // widget range ends at the chips' length so it does not overlap the marker's
    // own hide decoration.
    const titleLine = doc.line(firstLine);
    if (titleLine.from >= view.viewport.from && titleLine.to <= view.viewport.to &&
        !cursorLines.has(firstLine)) {
      const m = /^(>\s*\[!quote\]\s?)(.*)$/.exec(titleLine.text);
      if (m) {
        const chipStart = titleLine.from + m[1].length;
        const chipsStr = stripTagMarker(m[2]);
        entries.push({
          from: chipStart,
          to: chipStart + chipsStr.length,
          deco: Decoration.replace({ widget: new QuoteCardWidget(chipsStr) }),
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
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
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
