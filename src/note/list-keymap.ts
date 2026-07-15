import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { showToast } from "../shared/toast";
import {
  canDemote,
  isListItemLine,
  lineDepth,
  outdentLine,
  prevListItemDepth,
  listSubtreeEnd,
  leadingColumns,
  orderedListMarkerChanges,
} from "./list-indent";

const INDENT = "    ";
const CAP_MSG = "列表相邻项最多相差一级";

/** All line texts as a 0-based array, for prevListItemDepth. */
function docLines(doc: { line(n: number): { text: string }; lines: number }): string[] {
  const out: string[] = [];
  for (let i = 1; i <= doc.lines; i++) out.push(doc.line(i).text);
  return out;
}

/** Tab/Shift-Tab operate on every selected line. If the last selected line is
 * a list item, its descendant subtree is included to keep hierarchy intact. */
function selectedLineIndexes(view: EditorView): { start: number; end: number } {
  const { doc, selection } = view.state;
  const sel = selection.main;
  const startLine = doc.lineAt(sel.from);
  let endLine = doc.lineAt(sel.to);
  if (sel.from !== sel.to && sel.to === endLine.from && endLine.number > startLine.number) {
    endLine = doc.line(endLine.number - 1);
  }
  const lines = docLines(doc);
  let end = endLine.number - 1;
  if (isListItemLine(lines[end] ?? "")) end = listSubtreeEnd(lines, end);
  return { start: startLine.number - 1, end };
}

function dispatchIndent(view: EditorView, direction: "indent" | "outdent"): boolean {
  const { start, end } = selectedLineIndexes(view);
  const changes: Array<{ from: number; to?: number; insert: string }> = [];
  for (let i = start; i <= end; i++) {
    const line = view.state.doc.line(i + 1);
    if (direction === "indent") {
      const prefix = /^[ \t]*/.exec(line.text)?.[0] ?? "";
      changes.push({
        from: line.from,
        to: line.from + prefix.length,
        insert: " ".repeat(leadingColumns(prefix) + INDENT.length),
      });
    } else {
      const next = outdentLine(line.text);
      const removed = line.text.length - next.length;
      if (removed > 0) changes.push({ from: line.from, to: line.from + removed, insert: "" });
    }
  }
  if (changes.length === 0) return false;
  const indentTransaction = view.state.update({ changes });
  const indentedState = indentTransaction.state;
  const selection = view.state.selection.map(indentTransaction.changes, 1);
  const normalization = orderedListMarkerChanges(indentedState.doc.toString());
  if (normalization.length === 0) {
    view.dispatch({ changes, selection, scrollIntoView: true });
  } else {
    view.dispatch(
      { changes, selection, scrollIntoView: true },
      { changes: normalization, sequential: true },
    );
  }
  return true;
}

export function handleTab(view: EditorView): boolean {
  const state = view.state;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.from);
  if (isListItemLine(line.text)) {
    const curDepth = lineDepth(line.text);
    const prevDepth = prevListItemDepth(docLines(state.doc), line.number - 1);
    if (!canDemote(prevDepth, curDepth)) {
      showToast(CAP_MSG);
      return true;
    }
  }
  return dispatchIndent(view, "indent");
}

/** Shift-Tab: remove one 4-space unit from the line start. */
export function handleOutdent(view: EditorView): boolean {
  return dispatchIndent(view, "outdent");
}

/** Backspace at column 0: remove one indent unit. No indent (empty list item)
 *  → return false so markdownKeymap's deleteMarkupBackward removes the marker. */
export function handleBackspace(view: EditorView): boolean {
  const state = view.state;
  const sel = state.selection.main;
  if (sel.from !== sel.to) return false;
  const line = state.doc.lineAt(sel.from);
  if (sel.from !== line.from) return false;
  if (!/^\s/.test(line.text)) return false;
  const before = outdentLine(line.text);
  const removed = line.text.length - before.length;
  if (removed === 0) return false;
  const changes = { from: line.from, to: line.from + removed, insert: "" };
  const selection = { anchor: line.from };
  const outdentedState = state.update({ changes, selection }).state;
  const normalization = orderedListMarkerChanges(outdentedState.doc.toString());
  if (normalization.length === 0) {
    view.dispatch({ changes, selection });
  } else {
    view.dispatch(
      { changes, selection },
      { changes: normalization, sequential: true },
    );
  }
  return true;
}

export function listKeymap(): Extension {
  return Prec.highest(
    keymap.of([
      { key: "Tab", run: handleTab },
      { key: "Shift-Tab", run: handleOutdent },
      { key: "Backspace", run: handleBackspace },
      // insertNewlineContinueMarkup returns false on non-markup lines, so the
      // default Enter (insertNewlineAndIndent) still runs there. On list lines
      // it continues the marker; on an empty list item it exits the list.
      { key: "Enter", run: insertNewlineContinueMarkup },
    ]),
  );
}
