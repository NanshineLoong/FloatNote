import { syntaxTree } from "@codemirror/language";
import {
  StateField,
  type Transaction,
  type EditorState,
  type Extension,
  RangeSetBuilder,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
} from "@codemirror/view";
import { readBidMarker, stripBidMarker } from "../quote";
import { isSafeUrl } from "../inline";
import { stripTagMarker } from "@floatnote/note-logic";
import { olOrdinal } from "../list-indent";
import { outlineStateField } from "../outline-mode";
import { IconReadyEffect, iconStateKeyFor } from "./icons";
import { ACCENT, ACCENT_HOVER } from "../../styles/accent";
import { imageSourceField, SetImageSourceEffect } from "../image-interaction";
import {
  BulletWidget,
  OlNumberWidget,
  HrWidget,
  ImgWidget,
  LinkWidget,
  CheckboxWidget,
  TableWidget,
  QuoteCardWidget,
} from "./widgets";

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

function buildDecorations(state: EditorState): DecorationSet {
  const cursorLines = getCursorLines(state);
  const selRanges = state.selection.ranges;
  const entries: Array<{ from: number; to: number; deco: Decoration }> = [];
  const hide = Decoration.replace({});
  const doc = state.doc;
  const outlineOn = !!state.field(outlineStateField, false)?.on;
  const imageSource = state.field(imageSourceField, false);
  // Live-preview decorations include block widgets (tables, code blocks) and
  // line-break-spanning replacements, which CodeMirror only permits from a
  // StateField — never a ViewPlugin. StateFields have no viewport, so we walk
  // the whole document; note-sized files make this cheap and it keeps block
  // widgets stable across scrolling instead of flickering at viewport edges.
  const vpFrom = 0;
  const vpTo = doc.length;

  const onCursorLine = (pos: number) => outlineOn ? false : cursorLines.has(doc.lineAt(pos).number);
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
  const activeFencedCode: Array<{ from: number; to: number }> = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "FencedCode") return;
      if (rangeTouchesSelection(selRanges, node.from, node.to)) {
        activeFencedCode.push({ from: node.from, to: node.to });
      }
    },
  });
  const inActiveFence = (from: number, to: number) =>
    activeFencedCode.some((range) => from >= range.from && to <= range.to);

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
          if (inActiveFence(node.from, node.to)) return false;
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
              // A parent item keeps the same bullet as a leaf item. The fold
              // control is inserted before it, so adding a third level no
              // longer changes how the second level is rendered.
              deco: outlineOn
                ? hide
                : Decoration.replace({ widget: new BulletWidget() }),
            });
          } else {
            if (outlineOn) {
              entries.push({ from: node.from, to: node.to, deco: hide });
              return false;
            }
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
          if (outlineOn) return false;
          if (onCursorLine(node.from)) return false;
          entries.push({
            from: node.from,
            to: node.to,
            deco: Decoration.replace({ widget: new HrWidget() }),
          });
          return false;
        }

        case "Image": {
          if (outlineOn) return false;
          if (imageSource && node.from >= imageSource.from && node.to <= imageSource.to) return false;
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
          const imageLine = doc.lineAt(node.from);
          const prefix = doc.sliceString(imageLine.from, node.from);
          const suffix = doc.sliceString(to, imageLine.to)
            .replace(/<!-- floatnote:[a-z]+=[^>]*? -->/g, "");
          // A block figure must own its whole source line. Replacing an inline
          // Image node would make the prose on either side appear to belong to
          // the widget and breaks click/selection boundaries.
          if (prefix.trim() !== "" || suffix.trim() !== "") return false;
          const url = raw.match(/\(([^)]+)\)/)?.[1].trim() ?? "";
          if (url) {
            entries.push({
              from: node.from,
              to,
              deco: Decoration.replace({ widget: new ImgWidget(doc.sliceString(node.from, to), node.from, to) }),
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
          if (outlineOn) return false;
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
          if (outlineOn) {
            entries.push({ from: node.from, to: node.to, deco: hide });
            return false;
          }
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
          if (outlineOn) return false;
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
    if (outlineOn) continue;
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
    if (m && !outlineOn && !cursorLines.has(line.number)) {
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
    if (outlineOn) continue;
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
        const iconStateKey = iconStateKeyFor(bundleId);
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
    if (shouldMapPreviewDecorations(tr)) return tr.docChanged ? deco.map(tr.changes) : deco;
    const iconReady = tr.effects.some((e) => e.is(IconReadyEffect));
    const imageModeChanged = tr.effects.some((e) => e.is(SetImageSourceEffect));
    const outlineBefore = !!tr.startState.field(outlineStateField, false)?.on;
    const outlineAfter = !!tr.state.field(outlineStateField, false)?.on;
    if (tr.docChanged || tr.selection || iconReady || imageModeChanged || outlineBefore !== outlineAfter) {
      return buildDecorations(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** IME candidate text lives in CodeMirror's composing DOM. Rebuilding live
 * preview widgets during that transaction makes WebKit re-resolve the DOM
 * selection and paints the candidate as selected. Keep the current decoration
 * objects and only map their positions until the composition is confirmed. */
export function shouldMapPreviewDecorations(tr: Transaction): boolean {
  return tr.isUserEvent("input.type.compose");
}

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
    outline: `2px solid ${ACCENT}`,
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
    color: ACCENT,
    textDecoration: "underline",
    cursor: "pointer",
  },
  ".cm-preview-link:hover": { color: ACCENT_HOVER },
  ".cm-preview-ol-mark": { color: "#374151", fontWeight: "600" },
  ".cm-preview-list": {
    paddingLeft: "0.6em",
    listStyleType: "none",
  },
  ".cm-preview-figure.cm-img-active": { outline: `2px solid ${ACCENT}`, borderRadius: "4px" },
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
    background: ACCENT,
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
  return [imageSourceField, previewField, previewTheme];
}
