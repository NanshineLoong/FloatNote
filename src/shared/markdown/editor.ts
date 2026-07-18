import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting, syntaxTree, type LanguageDescription } from "@codemirror/language";
import { type EditorState, Range, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { Autolink, Strikethrough, Table, TaskList } from "@lezer/markdown";
import { tags } from "@lezer/highlight";

export const sharedMarkdownExtensions = [Autolink, Table, Strikethrough, TaskList];

const sharedMarkdownHighlight = HighlightStyle.define([
  { tag: tags.heading, fontWeight: "600" },
  { tag: tags.quote, color: "var(--color-text-muted)" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: tags.monospace, fontFamily: "var(--font-mono)" },
  { tag: tags.link, color: "var(--color-accent)", textDecoration: "underline" },
]);

function lineDecorations(
  state: EditorState,
  from: number,
  to: number,
  className: string,
  ranges: Range<Decoration>[],
): void {
  let line = state.doc.lineAt(from);
  const last = state.doc.lineAt(Math.max(from, to - 1)).number;
  while (line.number <= last) {
    ranges.push(Decoration.line({ class: className }).range(line.from));
    if (line.number === last) break;
    line = state.doc.line(line.number + 1);
  }
}

function buildPreview(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      const heading = /^ATXHeading([1-6])$/u.exec(node.name);
      if (heading) {
        lineDecorations(state, node.from, node.to, `cm-md-heading-${heading[1]}`, ranges);
        return;
      }
      if (node.name === "Blockquote") {
        lineDecorations(state, node.from, node.to, "cm-md-blockquote", ranges);
      } else if (node.name === "FencedCode") {
        lineDecorations(state, node.from, node.to, "cm-md-codeblock", ranges);
      } else if (node.name === "Task") {
        lineDecorations(state, node.from, node.to, "cm-md-task-list", ranges);
      } else if (node.name === "Table") {
        lineDecorations(state, node.from, node.to, "cm-md-table", ranges);
      } else if (node.name === "InlineCode") {
        ranges.push(Decoration.mark({ class: "cm-md-inline-code" }).range(node.from, node.to));
      } else if (node.name === "StrongEmphasis") {
        ranges.push(Decoration.mark({ class: "cm-md-strong" }).range(node.from, node.to));
      } else if (node.name === "Emphasis") {
        ranges.push(Decoration.mark({ class: "cm-md-emphasis" }).range(node.from, node.to));
      } else if (node.name === "Strikethrough") {
        ranges.push(Decoration.mark({ class: "cm-md-strikethrough" }).range(node.from, node.to));
      } else if (/Mark$/u.test(node.name)) {
        ranges.push(Decoration.mark({ class: "cm-md-mark" }).range(node.from, node.to));
      }
    },
  });
  return Decoration.set(ranges, true);
}

export const lightMarkdownPreview = StateField.define<DecorationSet>({
  create: buildPreview,
  update(decorations, transaction) {
    if (transaction.isUserEvent("input.type.compose")) {
      return transaction.docChanged ? decorations.map(transaction.changes) : decorations;
    }
    if (transaction.docChanged || transaction.selection) return buildPreview(transaction.state);
    return decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function markdownEditorExtensions(options: {
  codeLanguages?: readonly LanguageDescription[];
  livePreview?: boolean;
} = {}): Extension[] {
  return [
    markdown({
      extensions: sharedMarkdownExtensions,
      codeLanguages: options.codeLanguages ? [...options.codeLanguages] : undefined,
    }),
    syntaxHighlighting(sharedMarkdownHighlight),
    ...(options.livePreview === false ? [] : [lightMarkdownPreview]),
  ];
}
