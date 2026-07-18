import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, Transaction, type Extension } from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { livePreview, setNoteDir } from "./preview";
import { listFold } from "./list-fold";
import { attachImageToolbar } from "./image-toolbar";
import { listKeymap } from "./list-keymap";
import { tableKeymap } from "./table-keymap";
import { htmlPasteHandler, imagePasteHandler } from "./paste";
import { imageDropHandler } from "./image-drop";
import { markdownInputKeymap } from "./markdown-keymap";
import { preciseSelectionRendering } from "./selection-render";
import { hardBreakSpacing } from "./hard-break-spacing";
import { sharedMarkdownExtensions } from "../shared/markdown/editor";

const highlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.quote, color: "var(--color-text-muted)", fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  // Code (fenced-code bodies parsed by nested language parsers, plus inline
  // code and CodeText) get token-level coloring here. Low-saturation dark
  // palette so it reads as code without competing with the prose style.
  { tag: tags.monospace, fontFamily: "ui-monospace, 'SF Mono', monospace", fontSize: "0.9em" },
  { tag: tags.comment, color: "var(--color-syntax-comment)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--color-syntax-keyword)" },
  { tag: tags.atom, color: "var(--color-syntax-literal)" },
  { tag: tags.bool, color: "var(--color-syntax-literal)" },
  { tag: tags.number, color: "var(--color-syntax-literal)" },
  { tag: tags.string, color: "var(--color-syntax-string)" },
  { tag: tags.special(tags.string), color: "var(--color-syntax-string)" },
  { tag: tags.escape, color: "var(--color-syntax-literal)" },
  { tag: tags.variableName, color: "var(--color-syntax-variable)" },
  { tag: tags.definition(tags.variableName), color: "var(--color-syntax-variable)", fontWeight: "600" },
  { tag: tags.function(tags.variableName), color: "var(--color-syntax-function)" },
  { tag: tags.function(tags.definition(tags.variableName)), color: "var(--color-syntax-function)", fontWeight: "600" },
  { tag: tags.propertyName, color: "var(--color-syntax-property)" },
  { tag: tags.typeName, color: "var(--color-syntax-type)" },
  { tag: tags.tagName, color: "var(--color-syntax-type)" },
  { tag: tags.attributeName, color: "var(--color-syntax-property)" },
  { tag: tags.attributeValue, color: "var(--color-syntax-string)" },
  { tag: tags.operator, color: "var(--color-syntax-punctuation)" },
  { tag: tags.punctuation, color: "var(--color-syntax-punctuation)" },
  { tag: tags.meta, color: "var(--color-syntax-punctuation)" },
  { tag: tags.regexp, color: "var(--color-syntax-string)" },
]);

/**
 * Languages whose fenced code blocks (```lang) get a real nested parser so the
 * body stays editable text with token-level highlighting, instead of being
 * replaced by a non-editable widget. `LanguageDescription` lazy-loads the
 * parser on first use, so only languages actually used in a doc are ever
 * fetched. Add a language here + its `@codemirror/lang-*` dependency to extend.
 */
const codeLanguages: LanguageDescription[] = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "javascript", "jsx"],
    extensions: ["js", "mjs", "cjs"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript()),
  }),
  LanguageDescription.of({
    name: "TypeScript",
    alias: ["ts", "typescript", "tsx"],
    extensions: ["ts"],
    load: () => import("@codemirror/lang-javascript").then((m) => m.javascript({ typescript: true })),
  }),
  LanguageDescription.of({
    name: "JSON",
    alias: ["json"],
    extensions: ["json", "jsonc"],
    load: () => import("@codemirror/lang-json").then((m) => m.json()),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["html"],
    extensions: ["html", "htm"],
    load: () => import("@codemirror/lang-html").then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: "CSS",
    alias: ["css"],
    extensions: ["css"],
    load: () => import("@codemirror/lang-css").then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py", "python"],
    extensions: ["py"],
    load: () => import("@codemirror/lang-python").then((m) => m.python()),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rs", "rust"],
    extensions: ["rs"],
    load: () => import("@codemirror/lang-rust").then((m) => m.rust()),
  }),
  LanguageDescription.of({
    name: "SQL",
    alias: ["sql"],
    extensions: ["sql"],
    load: () => import("@codemirror/lang-sql").then((m) => m.sql()),
  }),
];

const baseContent = {
  fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif',
  lineHeight: "1.6",
  padding: "16px 0",
};

const readOnlyCompartments = new WeakMap<EditorView, Compartment>();

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
    ".cm-content": grow
      ? { ...baseContent, padding: "16px var(--piece-content-inset, 0px)", minHeight: "100%" }
      : baseContent,
    ".cm-line": { minHeight: "1.6em" },
    // Soft wrapping stays compact inside a single .cm-line. This class is
    // attached only to a line with a preceding literal newline.
    ".cm-hard-break-line": { paddingTop: "0.26em" },
    ".cm-placeholder": {
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      pointerEvents: "none",
    },
    ".cm-cursor, .cm-dropCursor": {
      transition: "none",
    },
    ".cm-content ::selection": { backgroundColor: "var(--color-selected)" },
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
  const readOnlyCompartment = new Compartment();
  const view = new EditorView({
    parent,
    extensions: [
      history(),
      readOnlyCompartment.of(EditorState.readOnly.of(false)),
      preciseSelectionRendering,
      hardBreakSpacing,
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown({ extensions: sharedMarkdownExtensions, codeLanguages }),
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
      ...listFold(),
      listKeymap(),
      markdownInputKeymap(),
      tableKeymap(),
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
  readOnlyCompartments.set(view, readOnlyCompartment);
  // Seed the image-widget noteDir map immediately; the ViewPlugin above keeps
  // it fresh on doc/selection/focus change before the preview plugin rebuilds.
  setNoteDir(view, noteDirProvider());
  // Editors are long-lived; best-effort wiring for drop + toolbar. Cleanup is
  // not invoked (app lifetime), but we call the setup so the handlers attach.
  void imageDropHandler(noteDirProvider, () => view);
  attachImageToolbar(view);
  return view;
}

export function setEditorReadOnly(view: EditorView, readOnly: boolean): void {
  const compartment = readOnlyCompartments.get(view);
  if (!compartment) return;
  view.dispatch({ effects: compartment.reconfigure(EditorState.readOnly.of(readOnly)) });
}

export function setDoc(view: EditorView, content: string) {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } });
}

export function replaceDocWithoutHistory(view: EditorView, content: string): void {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
    annotations: Transaction.addToHistory.of(false),
  });
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
