import { invoke } from "@tauri-apps/api/core";

export interface VersionEntry {
  v: number;
  ts: string;
  source: "ai" | "manual";
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

export function restoreVersion(
  dir: string,
  noteId: string,
  path: string,
  currentContent: string,
  v: number,
): Promise<string> {
  return invoke<string>("restore_version", { dir, noteId, path, currentContent, v });
}

export function formatVersionLabel(entry: VersionEntry): string {
  const time = entry.ts.slice(11, 16); // "HH:MM" from RFC3339
  const who = entry.source === "ai" ? "AI" : "手动";
  return `v${entry.v} · ${who} · ${time}`;
}
