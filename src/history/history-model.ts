import type { ChatConversation, ChatScopeType } from "../platform/chat-history";

export interface HistoryGroup {
  label: string;
  conversations: ChatConversation[];
}

export function scopeFilterKey(scopeType: ChatScopeType, scopePath: string): string {
  return `${scopeType}:${scopePath}`;
}

export function filterAndGroupHistory(
  conversations: ChatConversation[],
  filter: string,
  now = Date.now(),
): HistoryGroup[] {
  const filtered = filter === "all"
    ? conversations
    : conversations.filter((conversation) => scopeFilterKey(conversation.scopeType, conversation.scopePath) === filter);
  const groups = new Map<string, ChatConversation[]>();

  for (const conversation of filtered) {
    const label = historyGroupLabel(conversation.updatedAt, now);
    const group = groups.get(label) ?? [];
    group.push(conversation);
    groups.set(label, group);
  }

  return [...groups.entries()]
    .map(([label, items]) => ({
      label,
      conversations: [...items].sort((a, b) => b.updatedAt - a.updatedAt),
    }))
    .sort((a, b) => b.conversations[0].updatedAt - a.conversations[0].updatedAt);
}

export function fallbackConversationTitle(firstMessage: string, defaultTitle = "新对话"): string {
  const trimmed = firstMessage.trim();
  if (!trimmed) return defaultTitle;
  const chars = [...trimmed];
  return chars.slice(0, 10).join("");
}

export function normalizeGeneratedTitle(title: string, maxLength = 24): string {
  const plain = title
    .replace(/[*_`#>]/g, "")
    .replace(/[“”"'‘’]/g, "")
    .replace(/\s+/g, "")
    .trim();
  return [...plain].slice(0, maxLength).join("");
}

function historyGroupLabel(timestamp: number, now: number): string {
  const date = new Date(timestamp);
  const today = startOfLocalDay(new Date(now));
  const day = startOfLocalDay(date);
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (days === 0) return "今天";
  if (days === 1) return "昨天";
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
