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
} from "./list-indent";

const INDENT = "    ";
const CAP_MSG = "列表相邻项最多相差一级";

/** All line texts as a 0-based array, for prevListItemDepth. */
function docLines(doc: { line(n: number): { text: string }; lines: number }): string[] {
  const out: string[] = [];
  for (let i = 1; i <= doc.lines; i++) out.push(doc.line(i).text);
  return out;
}

/** Tab: indent any line by 4 spaces (list lines demote, subject to the
 *  one-level cap). Multi-character selections fall through to the default. */
function handleTab(view: EditorView): boolean {
  const state = view.state;
  const sel = state.selection.main;
  if (sel.from !== sel.to) return false;
  const line = state.doc.lineAt(sel.from);
  if (isListItemLine(line.text)) {
    const curDepth = lineDepth(line.text);
    const prevDepth = prevListItemDepth(docLines(state.doc), line.number - 1);
    if (!canDemote(prevDepth, curDepth)) {
      showToast(CAP_MSG);
      return true;
    }
  }
  view.dispatch({
    changes: { from: line.from, insert: INDENT },
    selection: { anchor: sel.from + INDENT.length },
    scrollIntoView: true,
  });
  return true;
}

/** Shift-Tab: remove one 4-space unit from the line start. */
function handleOutdent(view: EditorView): boolean {
  const state = view.state;
  const sel = state.selection.main;
  if (sel.from !== sel.to) return false;
  const line = state.doc.lineAt(sel.from);
  if (!/^\s/.test(line.text)) return false;
  const before = outdentLine(line.text);
  const removed = line.text.length - before.length;
  if (removed === 0) return false;
  view.dispatch({
    changes: { from: line.from, to: line.from + removed, insert: "" },
    selection: { anchor: Math.max(line.from, sel.from - removed) },
  });
  return true;
}

/** Backspace at column 0: remove one indent unit. No indent (empty list item)
 *  → return false so markdownKeymap's deleteMarkupBackward removes the marker. */
function handleBackspace(view: EditorView): boolean {
  const state = view.state;
  const sel = state.selection.main;
  if (sel.from !== sel.to) return false;
  const line = state.doc.lineAt(sel.from);
  if (sel.from !== line.from) return false;
  if (!/^\s/.test(line.text)) return false;
  const before = outdentLine(line.text);
  const removed = line.text.length - before.length;
  if (removed === 0) return false;
  view.dispatch({
    changes: { from: line.from, to: line.from + removed, insert: "" },
    selection: { anchor: line.from },
  });
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
