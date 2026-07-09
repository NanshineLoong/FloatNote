import { markdownLanguage } from "@codemirror/lang-markdown";
import { MarkdownParser, Strikethrough } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";

// Configure a parser that also understands ~~strike~~ so strikethrough in
// table cells parses the same way it does in the editor (GFM enabled in
// editor.ts). `markdownLanguage.parser` is the MarkdownParser from Lezer;
// `LRLanguage.parser` is typed as the base `Parser`, so cast to configure.
const inlineParser = (markdownLanguage.parser as MarkdownParser).configure([
  Strikethrough,
]);

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Walk a node's children in order, interleaving the (escaped) text that lives
// in the gaps between named child nodes. Lezer's markdown tree represents
// inline prose as uncovered spans between syntax nodes — e.g. in
// `*em*` the `Emphasis` node has only two `EmphasisMark` children; the actual
// text "em" is the gap between them. Iterating `firstChild`/`nextSibling`
// alone would drop all of it, so we fill every gap with escaped text.
function renderChildren(node: SyntaxNode, text: string): string {
  let out = "";
  let pos = node.from;
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.from > pos) out += escapeHtml(text.slice(pos, c.from));
    out += renderNode(c, text);
    pos = Math.max(pos, c.to);
  }
  if (node.to > pos) out += escapeHtml(text.slice(pos, node.to));
  return out;
}

function renderNode(node: SyntaxNode, text: string): string {
  switch (node.name) {
    // Structural marks: their text is part of the syntax, not content.
    case "EmphasisMark":
    case "StrikethroughMark":
    case "CodeMark":
    case "LinkMark":
      return "";
    case "Document":
    case "Paragraph":
      return renderChildren(node, text);
    case "StrongEmphasis":
      return `<strong>${renderChildren(node, text)}</strong>`;
    case "Emphasis":
      return `<em>${renderChildren(node, text)}</em>`;
    case "Strikethrough":
      return `<del>${renderChildren(node, text)}</del>`;
    case "InlineCode": {
      const raw = text.slice(node.from, node.to);
      const code = raw.replace(/^`+|`+$/g, "");
      return `<code>${escapeHtml(code)}</code>`;
    }
    case "Link": {
      const raw = text.slice(node.from, node.to);
      const m = /^\[([\s\S]*)\]\(([\s\S]*)\)$/.exec(raw);
      if (m) return `<a href="${escapeHtml(m[2].trim())}">${renderInline(m[1])}</a>`;
      return escapeHtml(raw);
    }
    case "Escape": {
      // backslash escape: emit the escaped character itself, escaped for HTML.
      const raw = text.slice(node.from, node.to);
      const ch = raw.replace(/^\\/, "");
      return escapeHtml(ch);
    }
    default:
      if (node.firstChild) return renderChildren(node, text);
      return escapeHtml(text.slice(node.from, node.to));
  }
}

/** Render a snippet of inline markdown to an HTML string. Text is HTML-escaped;
 *  only a known set of inline tags is emitted, so the result is safe for
 *  `innerHTML` in table cells. */
export function renderInline(text: string): string {
  const tree = inlineParser.parse(text);
  return renderNode(tree.topNode, text);
}
