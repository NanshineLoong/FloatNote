import { invoke } from "@tauri-apps/api/core";

export interface VersionEntry {
  v: number;
  ts: string;
  source: "ai" | "manual" | "restore";
  summary: string | null;
}

export function listVersions(dir: string, noteId: string): Promise<VersionEntry[]> {
  return invoke<VersionEntry[]>("list_versions", { dir, noteId });
}

export function snapshotNote(
  dir: string,
  noteId: string,
  content: string,
  source: "ai" | "manual",
): Promise<number> {
  return invoke<number>("snapshot_note", { dir, noteId, content, source });
}

export function readVersion(dir: string, noteId: string, v: number): Promise<string> {
  return invoke<string>("read_version", { dir, noteId, v });
}

export function renameVersion(
  dir: string,
  noteId: string,
  v: number,
  name: string,
): Promise<void> {
  return invoke<void>("rename_version", { dir, noteId, v, name });
}

export function deleteVersion(dir: string, noteId: string, v: number): Promise<void> {
  return invoke<void>("delete_version", { dir, noteId, v });
}

export function restoreVersion(
  dir: string,
  noteId: string,
  path: string,
  currentContent: string,
  v: number,
  expectedMtime: number | null,
): Promise<{ content: string; mtime: number | null }> {
  return invoke<{ content: string; mtime: number | null }>("restore_version", {
    dir,
    noteId,
    path,
    currentContent,
    v,
    expectedMtime,
  });
}

export function formatVersionEntry(
  entry: VersionEntry,
  currentYear = new Date().getFullYear(),
  timeZone?: string,
): { title: string; meta: string } {
  let time = entry.ts;
  const date = new Date(entry.ts);
  if (!Number.isNaN(date.getTime())) {
    try {
      const parts = new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone,
      }).formatToParts(date);
      const part = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((candidate) => candidate.type === type)?.value ?? "";
      const year = Number(part("year"));
      time = `${year === currentYear ? "" : `${year}年`}${Number(part("month"))}月${Number(part("day"))}日 ${part("hour")}:${part("minute")}`;
    } catch {
      // Preserve the raw timestamp for malformed legacy data or timezone input.
    }
  }
  return {
    title: entry.summary?.trim() || `版本 ${entry.v}`,
    meta: `${time}${entry.source === "ai" ? " · AI" : ""}`,
  };
}
