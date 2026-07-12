import { renderInline } from "../shared/markdown/inline";
import { escapeHtml } from "../shared/escape";

/**
 * 助手气泡的轻量 Markdown 渲染。
 *
 * 内联部分直接复用 `src/note/inline.ts` 的 `renderInline`（已带 `escapeHtml`
 * + `safeHref` 链接 scheme 白名单，拒绝 `javascript:/data:/vbscript:`）。
 * 块级部分自写一个最小 renderer：fenced code block / 标题 / 列表 / 段落。
 * 不引入 marked/markdown-it，与笔记 live-preview 体系分离。
 *
 * 安全：所有文本经 `renderInline`（内部 escape）；代码块内容用 textContent 设置。
 */

/** 把段落文本渲染为内联 HTML（renderInline 自带转义与链接白名单）。 */
function renderParagraph(text: string): string {
  return `<p>${renderInline(text)}</p>`;
}

/** 渲染一个非代码段为块级 HTML（标题/列表/段落）。 */
function renderProse(segment: string): string {
  const lines = segment.split("\n");
  const out: string[] = [];
  let i = 0;
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    out.push(`<${tag}>${list.items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</${tag}>`);
    list = null;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      flushList();
      i++;
      continue;
    }

    if (/^-{3,}$/.test(trimmed)) {
      flushList();
      out.push("<hr>");
      i++;
      continue;
    }

    // 标题：# ~ ######
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // 无序列表：- / * / +
    const ul = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (ul) {
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1].trim());
      i++;
      continue;
    }

    // 有序列表：1. / 2.
    const ol = /^\d+\.\s+(.*)$/.exec(trimmed);
    if (ol) {
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1].trim());
      i++;
      continue;
    }

    // 引用块：>
    const quote = /^>\s?(.*)$/.exec(trimmed);
    if (quote) {
      flushList();
      out.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      i++;
      continue;
    }

    // 段落（合并连续非空行为一段）
    flushList();
    const para: string[] = [trimmed];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(#{1,6}\s|[-*+]\s|\d+\.\s|>|-{3,}$)/.test(lines[i].trim()) && !/^```/.test(lines[i].trim())) {
      para.push(lines[i].trim());
      i++;
    }
    out.push(renderParagraph(para.join(" ")));
  }
  flushList();
  return out.join("");
}

/** 按 fenced code block（```）切段，分别渲染代码段（纯文本转义）与散文段。 */
export function renderMarkdown(text: string): string {
  if (!text) return "";
  const out: string[] = [];
  // 捕获 ``` 可选语言标识；非贪婪到下一个 ```。
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text)) !== null) {
    if (m.index > last) {
      out.push(renderProse(text.slice(last, m.index)));
    }
    const code = m[2].replace(/\n$/, "");
    out.push(`<pre class="chat-codeblock"><code>${escapeHtml(code)}</code></pre>`);
    last = fence.lastIndex;
  }
  if (last < text.length) {
    out.push(renderProse(text.slice(last)));
  }
  return out.join("");
}

/**
 * 把一段 markdown 文本渲染进一个容器节点：用 innerHTML 设置 renderMarkdown 产物。
 * 代码块内容会经 renderMarkdown 内的 escapeHtml 转义后内联进 <code>；
 * 由于整体经 renderInline/escape，安全。
 */
export function fillMarkdown(el: HTMLElement, text: string): void {
  el.innerHTML = renderMarkdown(text);
}
