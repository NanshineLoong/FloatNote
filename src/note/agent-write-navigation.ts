import type { NoteUpdated } from "../platform/agent";
import type { NoteEntry, ProjectEntry } from "./notes-state";

export type AgentWriteNavigation =
  | { kind: "inbox"; path: string }
  | { kind: "tasks"; path: string }
  | { kind: "piece"; entry: NoteEntry }
  | { kind: "document"; entry: NoteEntry };

export interface AgentWriteNavigationContext {
  mode: "project" | "document";
  project: ProjectEntry | null;
  document: NoteEntry | null;
}

function normalizePath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) ? normalized.toLowerCase() : normalized;
}

function samePath(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function containingDir(path: string): string {
  const normalized = normalizePath(path);
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "" : normalized.slice(0, separator);
}

export function resolveAgentWriteNavigation(
  updated: NoteUpdated,
  context: AgentWriteNavigationContext,
): AgentWriteNavigation | null {
  if (context.mode === "document") {
    return context.document && samePath(updated.path, context.document.path)
      ? { kind: "document", entry: context.document }
      : null;
  }

  if (!context.project || !samePath(containingDir(updated.path), context.project.path)) {
    return null;
  }
  if (updated.noteId === "_inbox") {
    return { kind: "inbox", path: updated.path };
  }
  if (updated.noteId === "_tasks") {
    return { kind: "tasks", path: updated.path };
  }
  if (updated.noteId.startsWith("_")) return null;
  return {
    kind: "piece",
    entry: { name: updated.noteId, path: updated.path },
  };
}
