/**
 * 候选过滤与打分（纯函数）。
 *
 * 子串匹配 + 轻量打分：前缀命中 > 词边界命中 > 子串命中；同分按标签更短优先，
 * 再按原始顺序（稳定）。空 query 返回全量（保持原序）。返回 {candidate, score}
 * 供 popover 直接取用。
 */
import type { Ref } from "./model";

export interface Candidate {
  ref: Ref;
  description?: string;
  /** 用于过滤但不在候选项中显示，例如本地化 Skill 的稳定英文 ID。 */
  keywords?: string;
}

export interface ScoredCandidate {
  candidate: Candidate;
  score: number;
}

const WORD_BOUNDARY = /[\/._\-\s]/;

/** 子串匹配 + 打分过滤。 */
export function filterItems(items: Candidate[], query: string): ScoredCandidate[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.map((candidate, score) => ({ candidate, score: 0 }));
  const out: ScoredCandidate[] = [];
  for (let i = 0; i < items.length; i++) {
    const c = items[i];
    const label = c.ref.display.toLowerCase();
    const desc = c.description?.toLowerCase() ?? "";
    const keywords = c.keywords?.toLowerCase() ?? "";
    const score = scoreMatch(label, desc, keywords, q);
    if (score < 0) continue;
    out.push({ candidate: c, score: score * 1000 + (1000 - label.length) + (items.length - i) });
  }
  // 分数降序；同分保稳定（sort 在 V8 稳定，不再加 tiebreak）。
  out.sort((a, b) => b.score - a.score);
  return out;
}

/** 返回 -1 表示不匹配；否则越大越相关。 */
function scoreMatch(label: string, desc: string, keywords: string, q: string): number {
  const li = label.indexOf(q);
  if (li === 0) return 500; // 前缀
  if (li > 0) {
    // 词边界优先：q 前一个字符是分隔符
    const before = label[li - 1] ?? "";
    return WORD_BOUNDARY.test(before) ? 300 : 200;
  }
  const di = desc.indexOf(q);
  if (di === 0) return 100;
  if (di > 0) return 50;
  const ki = keywords.indexOf(q);
  if (ki === 0) return 100;
  if (ki > 0) return 50;
  return -1;
}
