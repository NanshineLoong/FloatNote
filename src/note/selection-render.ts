import { RangeSetBuilder, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

type SelectionRange = { from: number; to: number };

/** Return the document positions of line-break characters included by selections. */
export function selectedLineBreakPositions(doc: Text, ranges: readonly SelectionRange[]): number[] {
  const positions = new Set<number>();

  for (const range of ranges) {
    if (range.from >= range.to) continue;

    const firstLine = doc.lineAt(range.from).number;
    const lastLine = doc.lineAt(range.to).number;
    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber++) {
      const line = doc.line(lineNumber);
      // A line's break is the character at `line.to`; the final virtual empty
      // line has no break because its `to` equals the document length.
      if (line.to < doc.length && range.from <= line.to && line.to < range.to) {
        positions.add(line.to);
      }
    }
  }

  return [...positions].sort((a, b) => a - b);
}

class SelectedLineBreakMarker extends WidgetType {
  toDOM(): HTMLElement {
    const marker = document.createElement("span");
    marker.className = "cm-selected-line-break";
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildMarkers(doc: Text, ranges: readonly SelectionRange[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const position of selectedLineBreakPositions(doc, ranges)) {
    builder.add(position, position, Decoration.widget({ widget: new SelectedLineBreakMarker(), side: 1 }));
  }
  return builder.finish();
}

const selectedLineBreakField = StateField.define<DecorationSet>({
  create(state) {
    return buildMarkers(state.doc, state.selection.ranges);
  },
  update(markers, transaction) {
    if (!transaction.docChanged && !transaction.selection) return markers;
    return buildMarkers(transaction.state.doc, transaction.state.selection.ranges);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Native selection paints exactly the selected text; these widgets make each
 * selected, otherwise-invisible line break visible as a small trailing cue. */
export const preciseSelectionRendering: Extension = selectedLineBreakField;
