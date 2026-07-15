export interface ExactTextQuery {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export type ExactTextMatch =
  | { ok: true; from: number; to: number }
  | { ok: false; error: "empty" | "not-found" | "ambiguous" };

export function findExactText(markdown: string, query: ExactTextQuery): ExactTextMatch {
  if (!query.exact) return { ok: false, error: "empty" };
  const matches: Array<{ from: number; to: number }> = [];
  let from = 0;
  while (from <= markdown.length) {
    const index = markdown.indexOf(query.exact, from);
    if (index < 0) break;
    const prefixMatches = query.prefix === undefined ||
      markdown.slice(Math.max(0, index - query.prefix.length), index) === query.prefix;
    const to = index + query.exact.length;
    const suffixMatches = query.suffix === undefined ||
      markdown.slice(to, to + query.suffix.length) === query.suffix;
    if (prefixMatches && suffixMatches) matches.push({ from: index, to });
    from = index + Math.max(1, query.exact.length);
  }
  if (matches.length === 0) return { ok: false, error: "not-found" };
  if (matches.length > 1) return { ok: false, error: "ambiguous" };
  return { ok: true, ...matches[0] };
}
