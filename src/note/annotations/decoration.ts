import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { InboxMetadata } from "@floatnote/note-logic";
import { inboxMetadata, replaceInboxMetadata } from "./state";

export interface AnnotationSpan {
  from: number;
  to: number;
  colors: string[];
  names: string[];
}

export function annotationSpans(metadata: InboxMetadata): AnnotationSpan[] {
  const order = new Map(metadata.tags.map((tag, index) => [tag.id, index]));
  const tags = new Map(metadata.tags.map((tag) => [tag.id, tag]));
  const points = [...new Set(metadata.annotations.flatMap((annotation) => [annotation.from, annotation.to]))]
    .sort((a, b) => a - b);
  const spans: AnnotationSpan[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    const covering = metadata.annotations
      .filter((annotation) => annotation.from <= from && annotation.to >= to)
      .sort((a, b) => (order.get(a.tagId) ?? Infinity) - (order.get(b.tagId) ?? Infinity));
    const definitions = covering.flatMap((annotation) => {
      const tag = tags.get(annotation.tagId);
      return tag ? [tag] : [];
    });
    if (definitions.length > 0) {
      spans.push({
        from,
        to,
        colors: definitions.map((tag) => tag.color),
        names: definitions.map((tag) => tag.name),
      });
    }
  }
  return spans;
}

function spanStyle(colors: string[]): string {
  const images = colors.map((color) => `linear-gradient(${color},${color})`).join(",");
  const sizes = colors.map(() => "100% 1px").join(",");
  const positions = colors.map((_color, index) => `0 calc(100% - ${index * 2 + 1}px)`).join(",");
  return `background-color:var(--annotation-bg,rgba(100,116,139,.12));background-image:${images};background-size:${sizes};background-position:${positions};background-repeat:no-repeat`;
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const span of annotationSpans(inboxMetadata(view.state))) {
    builder.add(span.from, span.to, Decoration.mark({
      class: "cm-inline-annotation",
      attributes: {
        style: spanStyle(span.colors),
        "aria-label": `已标注：${span.names.join("、")}`,
      },
    }));
  }
  return builder.finish();
}

const annotationDecorationPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.transactions.some((tr) => (
      tr.effects.some((effect) => effect.is(replaceInboxMetadata))
    ))) this.decorations = buildDecorations(update.view);
  }
}, { decorations: (plugin) => plugin.decorations });

export function annotationDecorations(): Extension {
  return annotationDecorationPlugin;
}
