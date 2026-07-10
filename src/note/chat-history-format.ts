import type { ChatTitleState } from "./chat-history";

export function deriveTitleFromFirstMessage(text: string): {
  title: string;
  titleState: ChatTitleState;
} {
  const trimmed = text.trim();
  const chars = [...trimmed];
  if (chars.length <= 10) {
    return { title: trimmed || "新对话", titleState: "final" };
  }
  return { title: chars.slice(0, 10).join(""), titleState: "temporary" };
}

export function formatHistoryTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const today = startOfLocalDay(new Date(now));
  const day = startOfLocalDay(date);
  const diffDays = Math.round((today.getTime() - day.getTime()) / 86_400_000);

  if (diffDays === 0) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  }
  if (diffDays === 1) return "昨天";
  if (date.getFullYear() === today.getFullYear()) {
    return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
  }
  return `${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
