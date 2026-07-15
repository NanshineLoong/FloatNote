import { listen } from "@tauri-apps/api/event";
import { EditorView } from "@codemirror/view";
import { buildCaretInsert } from "./append";
import { buildQuoteAppendChange, buildQuoteBlock, resolveMergeTarget, type Source } from "./quote";
import { htmlToMarkdown } from "./paste";
import { addQuoteSource, inboxMetadata } from "./annotations/state";

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
    const target = resolveMergeTarget(doc, caret, source, inboxMetadata(editor.state).quoteSources);
    if (target.kind === "merge") {
      const existing = doc.slice(target.range.from, target.range.to);
      const change = buildQuoteAppendChange(existing, target.range.from, target.range.to, body);
      editor.dispatch({
        changes: change,
        selection: { anchor: change.from + change.insert.length },
        scrollIntoView: true,
      });
    } else {
      // `target.at` is the caret when no card is nearby, or the end of the nearest
      // card when the source differs — so different-source quotes stack as sibling
      // blocks after the card instead of merging or splitting it.
      const at = target.at;
      const before = doc.slice(0, at);
      const after = doc.slice(at);
      const block = buildQuoteBlock(body, source);
      const insert = buildCaretInsert(before, after, block);
      const effects = source?.bundleId
        ? [addQuoteSource.of({ cardFrom: at + insert.indexOf(block), bundleId: source.bundleId })]
        : [];
      editor.dispatch({
        changes: { from: at, insert },
        effects,
        selection: { anchor: at + insert.length },
        scrollIntoView: true,
      });
    }
    editor.focus();
  });
}
