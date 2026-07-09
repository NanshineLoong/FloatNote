import { syntaxTree } from "@codemirror/language";
import { Prec, type EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Tables are `block: true` replace widgets, so CodeMirror's native vertical
 * motion can't drop the caret inside them — ↓ from the line above skips the
 * table, ↑ from below can fly to the document start (the layout reshapes
 * mid-motion when the reveal gate fires). This shim intercepts ArrowUp/ArrowDown
 * when the caret is on the line immediately before/after a table and dispatches
 * the caret directly to the table's first/last source offset, which trips the
 * Table reveal gate and lands the caret in editable source — no broken
 * vertical motion. The pure detection logic (`tableNeighbor`) is unit-tested.
 */

export type TableSide = "before" | "after" | "none";

export interface TableNeighbor {
  side: TableSide;
  /** Document offset of the table node's first character. */
  from: number;
  /** Document offset just past the table's last character. */
  to: number;
}

/**
 * Pure: is the caret at `pos` on the line immediately before or after a Table
 * node? "before" = caret line is the line above the table's first line;
 * "after" = caret line is the line below the table's last line. Returns
 * `{side:"none"}` otherwise (including when `pos` is inside the table).
 */
export function tableNeighbor(state: EditorState, pos: number): TableNeighbor {
  const caretLine = state.doc.lineAt(pos).number;
  let result: TableNeighbor = { side: "none", from: -1, to: -1 };
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "Table") return;
      const fromLine = state.doc.lineAt(node.from).number;
      const toLine = state.doc.lineAt(node.to).number;
      if (caretLine === fromLine - 1) {
        result = { side: "before", from: node.from, to: node.to };
        return false;
      }
      if (caretLine === toLine + 1) {
        result = { side: "after", from: node.from, to: node.to };
        return false;
      }
    },
  });
  return result;
}

/** Dispatch the caret into the table so the reveal gate turns it to source. */
function enterTable(view: EditorView, n: TableNeighbor, atEnd: boolean): boolean {
  view.dispatch({ selection: { anchor: atEnd ? n.to : n.from } });
  return true;
}

export function tableKeymap(): Extension {
  const onDown = (view: EditorView): boolean => {
    const sel = view.state.selection.main;
    if (sel.from !== sel.to) return false; // only a bare caret
    const n = tableNeighbor(view.state, sel.from);
    if (n.side !== "before") return false;
    return enterTable(view, n, false);
  };
  const onUp = (view: EditorView): boolean => {
    const sel = view.state.selection.main;
    if (sel.from !== sel.to) return false;
    const n = tableNeighbor(view.state, sel.from);
    if (n.side !== "after") return false;
    return enterTable(view, n, true);
  };
  // Prec.highest so these run before defaultKeymap's cursorLineUp/Down, which
  // would otherwise move the caret (and, around block widgets, skip/fly).
  return Prec.highest(
    keymap.of([
      { key: "ArrowDown", run: onDown },
      { key: "ArrowUp", run: onUp },
    ]),
  );
}
