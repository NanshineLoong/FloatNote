import { decodeInbox } from "@floatnote/note-logic";
import type { ProjectedRead } from "./types.js";

interface ReadWindow {
  text: string;
  totalLines: number;
  nextOffset?: number;
  from: number;
  to: number;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${name} 必须是正整数`);
  }
  return resolved;
}

export function paginateText(markdown: string, input: { offset?: number; limit?: number }): ReadWindow {
  const offset = positiveInteger(input.offset, 1, "offset");
  const limit = positiveInteger(input.limit, 200, "limit");
  const lines = markdown.split("\n");
  const startIndex = Math.min(offset - 1, lines.length);
  const endIndex = Math.min(startIndex + limit, lines.length);
  let from = 0;
  for (let index = 0; index < startIndex; index += 1) from += lines[index].length + 1;
  let to = from;
  for (let index = startIndex; index < endIndex; index += 1) {
    to += lines[index].length;
    if (index + 1 < endIndex) to += 1;
  }
  const text = lines
    .slice(startIndex, endIndex)
    .map((line) => line.replace(/\r$/, ""))
    .join("\n");
  return {
    text,
    totalLines: lines.length,
    ...(endIndex < lines.length ? { nextOffset: endIndex + 1 } : {}),
    from,
    to,
  };
}

function quoteExcerpt(markdown: string, cardFrom: number): string {
  const lineEnd = markdown.indexOf("\n", cardFrom);
  return markdown
    .slice(cardFrom, lineEnd < 0 ? markdown.length : lineEnd)
    .replace(/\r$/, "")
    .trim()
    .slice(0, 160) || "（空引用卡）";
}

export function projectInbox(
  raw: string,
  input: { offset?: number; limit?: number },
): ProjectedRead {
  const decoded = decodeInbox(raw);
  const window = paginateText(decoded.markdown, input);
  const tagById = new Map(decoded.metadata.tags.map((tag) => [tag.id, tag]));
  const annotations = decoded.metadata.annotations.filter(
    (annotation) => annotation.from < window.to && annotation.to > window.from,
  );
  const quoteSources = decoded.metadata.quoteSources.filter(
    (source) => source.cardFrom >= window.from && source.cardFrom <= window.to,
  );
  const context: string[] = ["[FloatNote context · read-only]"];
  if (decoded.metadata.tags.length > 0) {
    context.push("Tags:");
    for (const tag of decoded.metadata.tags) {
      context.push(`- ${tag.id}「${tag.name}」 color=${tag.color}`);
    }
  }
  if (annotations.length > 0) {
    context.push("Annotations in this read window:");
    for (const annotation of annotations) {
      const tag = tagById.get(annotation.tagId);
      const text = decoded.markdown.slice(annotation.from, annotation.to).replace(/\r?\n/g, " ");
      context.push(`- ${annotation.tagId}「${tag?.name ?? annotation.tagId}」 → “${text}”`);
    }
  }
  if (quoteSources.length > 0) {
    context.push("Quote sources in this read window:");
    for (const source of quoteSources) {
      context.push(`- “${quoteExcerpt(decoded.markdown, source.cardFrom)}” → ${source.bundleId}`);
    }
  }
  if (decoded.warnings.length > 0) {
    context.push("Warnings:");
    for (const warning of decoded.warnings) {
      context.push(`- ${warning.code}: ${warning.message}`);
    }
  }
  return {
    markdown: window.text,
    ...(context.length > 1 ? { context: context.join("\n") } : {}),
    totalLines: window.totalLines,
    ...(window.nextOffset ? { nextOffset: window.nextOffset } : {}),
  };
}

export function projectMarkdown(
  markdown: string,
  input: { offset?: number; limit?: number },
): ProjectedRead {
  const window = paginateText(markdown, input);
  return {
    markdown: window.text,
    totalLines: window.totalLines,
    ...(window.nextOffset ? { nextOffset: window.nextOffset } : {}),
  };
}
