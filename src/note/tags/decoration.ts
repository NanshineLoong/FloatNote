/**
 * CodeMirror decorations for tags:
 *  ① hide every `<!-- floatnote… -->` comment (the line-1 defs comment and all
 *     per-block markers) so they never render as literal text in the live preview;
 *  ② tint every tagged block — one translucent rounded card per block range.
 *
 * Re-parses the doc on every change; the doc text is the single source of truth.
 */
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { blockTagIds, isDefsLine, parseDefs } from "./model";
import { tint } from "./palette";

const HIDE = Decoration.replace({});

function buildDecorations(view: EditorView): DecorationSet {
  const doc = view.state.doc;
  const text = doc.toString();
  const entries: Array<{ from: number; to: number; deco: Decoration }> = [];

  // ① Hide the defs comment text on line 1 (the line itself is skipped by
  //    blockRanges, so it carries no handle; the comment text is hidden here).
  const nl = text.indexOf("\n");
  const line1 = nl === -1 ? text : text.slice(0, nl);
  if (isDefsLine(line1)) {
    entries.push({ from: 0, to: line1.length, deco: HIDE });
  }

  // ① Hide every per-block marker span.
  const markerRe = /<!-- floatnote:tag=([a-z0-9-]+) -->/g;
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(text)) !== null) {
    entries.push({ from: m.index, to: m.index + m[0].length, deco: HIDE });
  }

  // ② Tint tagged blocks.
  const tagMap = parseDefs(text);
  if (tagMap.size > 0) {
    for (const { range, id } of blockTagIds(text)) {
      if (!id) continue;
      const def = tagMap.get(id);
      if (!def) continue; // orphan marker: no tint, no crash
      const bg = tint(def.color);
      const style = `--tag-bg:${bg};--tag-accent:${def.color}`;
      const firstLine = doc.lineAt(range.from);
      const lastLine = doc.lineAt(Math.min(range.to, doc.length));
      for (let n = firstLine.number; n <= lastLine.number; n++) {
        const cl = doc.line(n);
        const isFirst = n === firstLine.number;
        const isLast = n === lastLine.number;
        const cls = [
          "cm-tagged-block",
          isFirst ? "cm-tagged-block-first" : "",
          isLast ? "cm-tagged-block-last" : "",
        ].filter(Boolean).join(" ");
        entries.push({
          from: cl.from,
          to: cl.from,
          deco: Decoration.line({ class: cls, attributes: { style } }),
        });
      }
    }
  }

  entries.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const e of entries) builder.add(e.from, e.to, e.deco);
  return builder.finish();
}

const tagDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export function tagDecorations(): Extension {
  return tagDecorationPlugin;
}
