import { invoke } from "@tauri-apps/api/core";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

export function selectedText(
  doc: string,
  from: number,
  to: number,
  focused: boolean,
): string | null {
  if (!focused || from < 0 || to <= from || to > doc.length) return null;
  const text = doc.slice(from, to);
  return text.trim() ? text : null;
}

function publish(text: string | null): void {
  void invoke("update_local_selection", { text });
}

export function localSelectionPublisher(): Extension {
  return EditorView.updateListener.of((update) => {
    if (!update.selectionSet && !update.focusChanged) return;
    const range = update.state.selection.main;
    publish(selectedText(
      update.state.doc.toString(),
      range.from,
      range.to,
      update.view.hasFocus,
    ));
  });
}

export function clearLocalSelection(): void {
  publish(null);
}
