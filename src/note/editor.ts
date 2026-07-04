import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { livePreview } from "./preview";
import { htmlPasteHandler } from "./paste";

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.quote, color: "#6b7280", fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.list, color: "#374151" },
]);

const baseContent = {
  fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
  lineHeight: "1.6",
  padding: "16px 0",
};

/**
 * `grow` 让编辑器长到内容高度、关掉自身的内部滚动（`.cm-scroller` overflow:visible）——
 * 这样标题块与正文能落在同一个外层滚动容器里一起滚（写作栏的 Notion 式手感）。
 * 默认（inbox）保持 height:100% 的内部滚动。
 */
function buildTheme(grow: boolean) {
  return EditorView.theme({
    "&": grow
      ? { height: "auto", minHeight: "100%", fontSize: "var(--editor-font, 15px)" }
      : { height: "100%", fontSize: "var(--editor-font, 15px)" },
    ".cm-content": grow ? { ...baseContent, minHeight: "100%" } : baseContent,
    ".cm-scroller": grow ? { overflow: "visible", minHeight: "100%" } : {},
    "&.cm-focused": { outline: "none" },
  });
}

export function createEditor(
  parent: HTMLElement,
  onChange: (doc: string) => void,
  extras: Extension[] = [],
  opts: { grow?: boolean } = {},
): EditorView {
  return new EditorView({
    parent,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      syntaxHighlighting(highlight),
      ...livePreview(),
      htmlPasteHandler(),
      buildTheme(opts.grow ?? false),
      EditorView.lineWrapping,
      ...extras,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  });
}

export function setDoc(view: EditorView, content: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
}

export function requestEditorLayout(
  view: Pick<EditorView, "requestMeasure">,
  schedule: (cb: FrameRequestCallback) => number = window.requestAnimationFrame,
) {
  schedule(() => view.requestMeasure());
}

export function insertAtPos(view: EditorView, pos: number, text: string) {
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    scrollIntoView: true,
  });
}

export function insertAtCaret(view: EditorView, text: string) {
  insertAtPos(view, view.state.selection.main.from, text);
}
