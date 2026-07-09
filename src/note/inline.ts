import { markdownLanguage } from "@codemirror/lang-markdown";
import { Autolink, MarkdownParser, Strikethrough } from "@lezer/markdown";
import type { SyntaxNode } from "@lezer/common";

// Configure a parser that also understands ~~strike~~ so strikethrough in
// table cells parses the same way it does in the editor (GFM enabled in
// editor.ts). `markdownLanguage.parser` is the MarkdownParser from Lezer;
// `LRLanguage.parser` is typed as the base `Parser`, so cast to configure.
// `Autolink` mirrors the editor: bare URLs / <url> become URL/Autolink nodes,
// and (because Lezer inline parsers don't run inside code) URLs inside inline
// code stay plain.
const inlineParser = (markdownLanguage.parser as MarkdownParser).configure([
  Strikethrough,
  Autolink,
]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Allowlist URL schemes/relative forms. Returns "" for
 *  anything that could execute script (javascript:, data:, vbscript:, …). */
function safeHref(url: string): string {
  return isSafeUrl(url) ? url.trim() : "";
}

/** True for schemes/relative forms safe to pass to the OS opener / href:
 *  https?:, mailto:, anchor (#), root (/), ./, ../. Everything else
 *  (javascript:, data:, vbscript:, …) is rejected — the backend `open_url`
 *  command does no scheme validation, so this is the only guard. */
export function isSafeUrl(url: string): boolean {
  const u = url.trim();
  if (u === "") return false;
  return /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(u);
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
      if (m) {
        const href = escapeHtml(safeHref(m[2]));
        return `<a href="${href}">${renderInline(m[1])}</a>`;
      }
      return escapeHtml(raw);
    }
    case "URL": {
      // Bare URL (Lezer Autolink extension). Display text == url.
      const url = text.slice(node.from, node.to);
      const href = escapeHtml(safeHref(url));
      return `<a href="${href}">${escapeHtml(url)}</a>`;
    }
    case "Autolink": {
      // <url> syntax: node spans the angle brackets; inner URL is the text
      // between them. Strip the <…> for both href and display text.
      const url = text.slice(node.from + 1, node.to - 1);
      const href = escapeHtml(safeHref(url));
      return `<a href="${href}">${escapeHtml(url)}</a>`;
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
