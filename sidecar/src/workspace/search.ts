import { RE2JS } from "re2js";

export interface SearchDocument {
  path: string;
  content: string;
}

export interface SearchInput {
  pattern: string;
  literal?: boolean;
  ignoreCase?: boolean;
  context?: number;
  limit?: number;
}

export interface SearchResult {
  text: string;
  matchCount: number;
  truncated: boolean;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`${name} 必须在 ${min}..${max} 之间`);
  }
  return resolved;
}

export function filterPaths(paths: readonly string[], pattern: string): string[] {
  if (!pattern || pattern.includes("/") || pattern.includes("\\")) {
    throw new Error("当前工作区不支持子目录 glob");
  }
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`^${escaped.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
  return paths.filter((candidate) => regex.test(candidate));
}

export function searchDocuments(documents: readonly SearchDocument[], input: SearchInput): SearchResult {
  if (!input.pattern) throw new Error("pattern 不能为空");
  if (input.pattern.length > 256) throw new Error("pattern 不能超过 256 个字符");
  const context = boundedInteger(input.context, 0, 0, 10, "context");
  const limit = boundedInteger(input.limit, 100, 1, 1000, "limit");
  const literalPattern = input.ignoreCase ? input.pattern.toLocaleLowerCase() : input.pattern;
  let regex: RE2JS | undefined;
  if (!input.literal) {
    try {
      regex = RE2JS.compile(
        input.pattern,
        input.ignoreCase ? RE2JS.CASE_INSENSITIVE : 0,
      );
    } catch (error) {
      throw new Error(`正则表达式无效：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const output: string[] = [];
  let matchCount = 0;
  let truncated = false;
  for (const document of documents) {
    const lines = document.content.split("\n").map((line) => line.replace(/\r$/, ""));
    const emittedContext = new Set<number>();
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const matched = input.literal
        ? (input.ignoreCase ? line.toLocaleLowerCase() : line).includes(literalPattern)
        : regex!.matcher(line).find();
      if (!matched) continue;
      if (matchCount >= limit) {
        truncated = true;
        break;
      }
      const from = Math.max(0, index - context);
      const to = Math.min(lines.length - 1, index + context);
      for (let contextIndex = from; contextIndex <= to; contextIndex += 1) {
        if (contextIndex === index) continue;
        if (emittedContext.has(contextIndex)) continue;
        emittedContext.add(contextIndex);
        output.push(`${document.path}-${contextIndex + 1}-${lines[contextIndex].slice(0, 500)}`);
      }
      output.push(`${document.path}:${index + 1}:${line.slice(0, 500)}`);
      matchCount += 1;
    }
    if (truncated) break;
  }
  if (truncated) output.push(`[Results truncated at ${limit} matches]`);
  return { text: output.join("\n"), matchCount, truncated };
}
