import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { Strikethrough, Table, TaskList } from "@lezer/markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { livePreview, attachImageToolbar, setNoteDir } from "./preview";
import { listKeymap } from "./list-keymap";
import { htmlPasteHandler, imagePasteHandler } from "./paste";
import { imageDropHandler } from "./image-drop";

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
  opts: { grow?: boolean; noteDirProvider?: () => string } = {},
): EditorView {
  const noteDirProvider = opts.noteDirProvider ?? (() => "");
  const view = new EditorView({
    parent,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown({ extensions: [Table, Strikethrough, TaskList] }),
      syntaxHighlighting(highlight),
      // Refresh the image-widget noteDir map BEFORE the preview plugin rebuilds
      // decorations, so a setDoc (project/document switch) renders images with the
      // new dir. updateListener runs after plugin updates, so it can't help here.
      ViewPlugin.fromClass(
        class {
          update(u: ViewUpdate) {
            if (u.docChanged || u.selectionSet || u.focusChanged) {
              setNoteDir(view, noteDirProvider());
            }
          }
        },
      ),
      ...livePreview(),
      listKeymap(),
      // imagePasteHandler must come BEFORE htmlPasteHandler so the image check
      // runs first; it returns false (no image) and lets the html handler run.
      imagePasteHandler(noteDirProvider),
      htmlPasteHandler(),
      buildTheme(opts.grow ?? false),
      EditorView.lineWrapping,
      ...extras,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update.state.doc.toString());
      }),
    ],
  });
  // Seed the image-widget noteDir map immediately; the ViewPlugin above keeps
  // it fresh on doc/selection/focus change before the preview plugin rebuilds.
  setNoteDir(view, noteDirProvider());
  // Editors are long-lived; best-effort wiring for drop + toolbar. Cleanup is
  // not invoked (app lifetime), but we call the setup so the handlers attach.
  void imageDropHandler(noteDirProvider, () => view);
  attachImageToolbar(view);
  return view;
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
