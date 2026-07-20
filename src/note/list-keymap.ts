import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import {
  ChangeSet,
  EditorSelection,
  Prec,
  type ChangeSpec,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { showToast } from "../shared/toast";
import {
  canDemote,
  isListItemLine,
  lineDepth,
  outdentLine,
  leadingColumns,
  orderedListMarkerChanges,
} from "./list-indent";

const INDENT = "    ";
const CAP_MSG = "列表相邻项最多相差一级";

function previousListItemDepth(doc: EditorState["doc"], currentLine: number): number | null {
  for (let lineNumber = currentLine - 1; lineNumber >= 1; lineNumber -= 1) {
    const text = doc.line(lineNumber).text;
    if (text.trim() === "") continue;
    return isListItemLine(text) ? lineDepth(text) : null;
  }
  return null;
}

function listSubtreeEndLine(doc: EditorState["doc"], startLine: number): number {
  const start = doc.line(startLine);
  if (!isListItemLine(start.text)) return startLine;
  const depth = lineDepth(start.text);
  let endLine = startLine;
  for (let lineNumber = startLine + 1; lineNumber <= doc.lines; lineNumber += 1) {
    const text = doc.line(lineNumber).text;
    if (text.trim() === "") {
      endLine = lineNumber;
      continue;
    }
    if (isListItemLine(text)) {
      if (lineDepth(text) <= depth) break;
      endLine = lineNumber;
      continue;
    }
    if (leadingColumns(text) <= depth * 4) break;
    endLine = lineNumber;
  }
  return endLine;
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
  let end = endLine.number - 1;
  if (isListItemLine(endLine.text)) end = listSubtreeEndLine(doc, endLine.number) - 1;
  return { start: startLine.number - 1, end };
}

/** Compose indentation and ordered-marker normalization without materializing
 * a throwaway EditorState. State fields therefore update only for the single
 * transaction that is actually dispatched. */
function dispatchListChanges(
  view: EditorView,
  changes: ChangeSpec,
  selection = view.state.selection,
  scrollIntoView = false,
): void {
  const state = view.state;
  const primary = state.changes(changes);
  const changedDoc = primary.apply(state.doc);
  const normalizationSpecs = orderedListMarkerChanges(changedDoc.toString());
  const normalization = normalizationSpecs.length > 0
    ? ChangeSet.of(normalizationSpecs, changedDoc.length)
    : ChangeSet.empty(changedDoc.length);
  const combined = primary.compose(normalization);
  const mappedSelection = selection.map(primary, 1).map(normalization, 1);
  view.dispatch({ changes: combined, selection: mappedSelection, scrollIntoView });
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
  dispatchListChanges(view, changes, view.state.selection, true);
  return true;
}

export function handleTab(view: EditorView): boolean {
  const state = view.state;
  const sel = state.selection.main;
  const line = state.doc.lineAt(sel.from);
  if (isListItemLine(line.text)) {
    const curDepth = lineDepth(line.text);
    const prevDepth = previousListItemDepth(state.doc, line.number);
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
  dispatchListChanges(view, changes, EditorSelection.single(line.from));
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
