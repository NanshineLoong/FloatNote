import { RangeSetBuilder, StateField, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * Return the starts of logical lines that have a preceding, non-terminal
 * newline. Soft-wrapped visual lines have no document position here, so they
 * intentionally remain unmarked.
 */
export function hardBreakLineStarts(doc: Text): number[] {
  const starts: number[] = [];
  for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber++) {
    const line = doc.line(lineNumber);
    if (line.from < doc.length) starts.push(line.from);
  }
  return starts;
}

function buildSpacing(doc: Text): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const from of hardBreakLineStarts(doc)) {
    builder.add(from, from, Decoration.line({ class: "cm-hard-break-line" }));
  }
  return builder.finish();
}

const hardBreakSpacingField = StateField.define<DecorationSet>({
  create(state) {
    return buildSpacing(state.doc);
  },
  update(spacing, transaction) {
    return transaction.docChanged ? buildSpacing(transaction.state.doc) : spacing;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Adds a subtle gap before lines created by an explicit newline only. */
export const hardBreakSpacing: Extension = hardBreakSpacingField;
