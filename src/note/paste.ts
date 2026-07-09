import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import { savePastedImage } from "./image-fs";
import { showToast } from "../shared/toast";

/**
 * 粘贴时把剪贴板里的 HTML 片段转成 Markdown。
 *
 * 浏览器复制网页内容时，剪贴板里会同时放一份 `text/html`（带 `<ul>/<ol>/<table>/<strong>` 等结构）
 * 和一份被拍扁的 `text/plain`（列表前缀、加粗、表格几乎全丢）。CodeMirror 默认只读 `text/plain`，
 * 所以粘贴进来的内容会丢掉格式。这里在 paste 事件里改读 `text/html`，用 Turndown 转成 Markdown，
 * 列表/表格/加粗斜体都能保留。没有 HTML（比如从记事本粘贴纯文本）时退回默认行为。
 */
const turndown = new TurndownService({
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
  codeBlockStyle: "fenced",
});
turndown.use(gfm);

/** 把一段 HTML 片段转成 Markdown 文本；空 / 纯空白输入返回空串。 */
export function htmlToMarkdown(html: string): string {
  if (!html || !html.trim()) return "";
  // Turndown 的列表项标记后会有多余空格（如 `1.  first`），收敛成单空格，输出更干净。
  return turndown
    .turndown(html)
    .replace(/^(\s*)([-*+]|\d+\.)\s{2,}/gm, "$1$2 ")
    .trim();
}

/**
 * 当粘贴目标在 `>` 引用块行内时，给被粘贴的每一行续上 `>` 前缀，避免多行内容
 * （列表、表格、段落）只有第一行留在引用里、其余行因为没 `>` 开头而脱离引用块。
 * 不在引用行里就原样返回 `insert`。
 *
 * `lineText` 是包含 `from` 的文档行文本，`lineFrom` 是该行起始偏移。
 */
export function adaptPasteForQuote(
  lineText: string,
  from: number,
  lineFrom: number,
  insert: string,
): string {
  if (!lineText.startsWith(">") || !insert.includes("\n")) return insert;
  const quotePrefix = /^>(?:\s)?/.exec(lineText)![0];
  const lines = insert.split("\n");
  const quoteLine = (l: string) => (l.trim() === "" ? ">" : `> ${l}`);

  const caretCol = from - lineFrom;
  const atContentStart = caretCol === quotePrefix.length;
  const lineHasMoreContent = lineText.slice(quotePrefix.length).trim().length > 0;

  if (atContentStart && !lineHasMoreContent) {
    // 光标在「空引用行」的 `> ` 之后：第一行续在本行（不另起 `>`），其余行加前缀。
    // 若前缀没有尾随空格（裸 `>`），补一个空格，使 `>- a` 变成 `> - a`。
    const needSpace = !/\s$/.test(quotePrefix);
    const first =
      needSpace && lines[0].trim() !== "" ? ` ${lines[0]}` : lines[0];
    return [first, ...lines.slice(1).map(quoteLine)].join("\n");
  }

  // 否则把粘贴内容放到新的引用行上：先换行，再给每行加前缀。
  return ["", ...lines.map(quoteLine)].join("\n");
}

/**
 * CodeMirror 扩展：粘贴时若剪贴板带 `text/html`，就转成 Markdown 插入选区；
 * 否则放行默认行为（按 `text/plain` 插入）。返回 `true` 表示已消费该事件。
 * 若光标在引用块行内，会续上 `>` 前缀，让多行内容留在引用里。
 */
export function htmlPasteHandler(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const html = event.clipboardData?.getData("text/html");
      if (!html) return false;
      const md = htmlToMarkdown(html);
      if (!md) return false;
      event.preventDefault();
      const { from, to } = view.state.selection.main;
      const line = view.state.doc.lineAt(from);
      const insert = adaptPasteForQuote(line.text, from, line.from, md);
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        userEvent: "input.paste",
        scrollIntoView: true,
      });
      return true;
    },
  });
}

/**
 * 粘贴图片位图：剪贴板含 image/* 时，落盘到 <noteDir>/_assets/ 并在光标处插入
 * `![](./_assets/...)`。无图片时返回 false 放行给 htmlPasteHandler。20MB 上限
 * 由 savePastedImage 强制；失败 toast 后不插入。
 *
 * 注意（Task 10 接线时）：本扩展必须在 htmlPasteHandler 之前注册，使图片检查
 * 先于 HTML 粘贴；这里无图片时返回 false，后续处理器仍会触发。
 */
export function imagePasteHandler(getNoteDir: () => string): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const items = event.clipboardData?.items;
      if (!items) return false;
      let file: File | null = null;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          file = it.getAsFile();
          if (file) break;
        }
      }
      if (!file) return false;
      event.preventDefault();
      const dir = getNoteDir();
      if (!dir) { showToast("未打开项目"); return true; }
      const { from, to } = view.state.selection.main;
      void savePastedImage(dir, file)
        .then((link) => {
          view.dispatch({
            changes: { from, to, insert: `${link}\n` },
            selection: { anchor: from + link.length + 1 },
            userEvent: "input.paste",
            scrollIntoView: true,
          });
        })
        .catch((err) => {
          console.error("image paste failed", err);
          showToast(err instanceof Error ? err.message : "图片粘贴失败");
        });
      return true;
    },
  });
}
