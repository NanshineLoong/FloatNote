import { listen } from "@tauri-apps/api/event";
import { EditorView } from "@codemirror/view";
import { buildCaretInsert } from "./append";
import { buildQuoteBlock, mergeQuoteBlock, resolveMergeTarget, type Source } from "./quote";
import { htmlToMarkdown } from "./paste";
import { insertAtPos } from "./editor";

type QuotePayload = { text: string; html: string | null; source: Source | null };

/** 订阅 `quote-captured` 事件：把划线捕获的选区注入 inbox 编辑器。
 * 富文本源优先转 Markdown 以保留列表/表格/加粗格式；同源相邻卡片合并，
 * 异源则在最近卡片后作为兄弟块插入。 */
export function attachQuoteCapture(editor: EditorView) {
  void listen<QuotePayload>("quote-captured", (event) => {
    const { text, html, source } = event.payload;
    // 采集的选区可能带 `text/html`（浏览器、富文本编辑器）；有就转成 Markdown，
    // 让列表/表格/加粗在 quote 块里保留格式。转换为空（或纯文本源）时退回 text。
    const body = (html && htmlToMarkdown(html)) || text;
    const doc = editor.state.doc.toString();
    const caret = editor.state.selection.main.from;
    const target = resolveMergeTarget(doc, caret, source);
    if (target.kind === "merge") {
      const existing = doc.slice(target.range.from, target.range.to);
      const merged = mergeQuoteBlock(existing, body);
      editor.dispatch({
        changes: { from: target.range.from, to: target.range.to, insert: merged },
        selection: { anchor: target.range.from + merged.length },
        scrollIntoView: true,
      });
    } else {
      // `target.at` is the caret when no card is nearby, or the end of the nearest
      // card when the source differs — so different-source quotes stack as sibling
      // blocks after the card instead of merging or splitting it.
      const at = target.at;
      const before = doc.slice(0, at);
      const after = doc.slice(at);
      const insert = buildCaretInsert(before, after, buildQuoteBlock(body, source));
      insertAtPos(editor, at, insert);
    }
    editor.focus();
  });
}
