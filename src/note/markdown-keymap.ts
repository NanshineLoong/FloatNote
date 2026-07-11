import { Prec, type Extension } from "@codemirror/state";
import { type EditorView, keymap } from "@codemirror/view";

/** Complete a fenced code block before the browser inserts the third
 * backtick. The handler sees a line ending in exactly two backticks. */
export function handleFenceBacktick(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;

  if (sel.from !== sel.to) {
    const selected = state.doc.sliceString(sel.from, sel.to);
    const insert = `\`\`\`\n${selected}\n\`\`\``;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: sel.from + 4, head: sel.from + 4 + selected.length },
      scrollIntoView: true,
    });
    return true;
  }

  const line = state.doc.lineAt(sel.head);
  const before = state.doc.sliceString(line.from, sel.head);
  const match = /^(\s*)``$/.exec(before);
  if (!match) return false;
  const indent = match[1];
  const nextLine = line.number < state.doc.lines ? state.doc.line(line.number + 1).text : "";
  const hasClosingFence = new RegExp(`^${indent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\`{3,}\\s*$`)
    .test(nextLine);
  const insert = hasClosingFence
    ? `\`\n${indent}`
    : `\`\n${indent}\n${indent}\`\`\``;
  view.dispatch({
    changes: { from: sel.head, insert },
    selection: { anchor: sel.head + 2 + indent.length },
    scrollIntoView: true,
  });
  return true;
}

export function markdownInputKeymap(): Extension {
  return Prec.highest(keymap.of([{ key: "`", run: handleFenceBacktick }]));
}
