import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.quote, color: "#6b7280", fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.list, color: "#374151" },
]);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "var(--editor-font, 15px)" },
  ".cm-content": {
    fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
    lineHeight: "1.6",
    padding: "16px 14px",
  },
  "&.cm-focused": { outline: "none" },
});

export function createEditor(parent: HTMLElement, onChange: (doc: string) => void): EditorView {
  return new EditorView({
    parent,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      syntaxHighlighting(highlight),
      theme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  });
}

export function setDoc(view: EditorView, content: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
}

export function appendToEnd(view: EditorView, text: string) {
  const end = view.state.doc.length;
  view.dispatch({
    changes: { from: end, insert: text },
    selection: { anchor: end + text.length },
    scrollIntoView: true,
  });
}

