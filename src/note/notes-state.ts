import { invoke } from "@tauri-apps/api/core";
import { save, confirm } from "@tauri-apps/plugin-dialog";

export interface NoteEntry {
  name: string;
  path: string;
}

export interface ProjectEntry {
  name: string;
  path: string;
}

export const INBOX_FILE = "_inbox.md";
export const TASKS_FILE = "_tasks.md";

/** Join a project folder path with a child file, OS-correct separator. */
export function projectFilePath(projectPath: string, file: string): string {
  const sep = projectPath.includes("\\") ? "\\" : "/";
  const trimmed = projectPath.replace(/[\\/]+$/, "");
  return `${trimmed}${sep}${file}`;
}

export function tasksPath(projectPath: string): string {
  return projectFilePath(projectPath, TASKS_FILE);
}

/** Join a project folder path with its `_inbox.md`, choosing the separator from
 * the folder path so it stays correct on both Windows (`\\`) and POSIX (`/`). */
export function inboxPath(projectPath: string): string {
  const sep = projectPath.includes("\\") ? "\\" : "/";
  const trimmed = projectPath.replace(/[\\/]+$/, "");
  return `${trimmed}${sep}${INBOX_FILE}`;
}

/** The editor binds to a project's Inbox file. Expose it as a `NoteEntry` named
 * `_inbox` so the existing editor / agent / version wiring keeps working. */
export function inboxEntry(project: ProjectEntry): NoteEntry {
  return { name: "_inbox", path: inboxPath(project.path) };
}

export interface Config {
  working_dir: string | null;
  shortcut_capture: string;
  shortcut_toggle: string;
  font_size: number;
  launch_at_login: boolean;
  recent_projects: string[];
  recent_documents: string[];
}

export interface CurrentNote {
  dir: string;
  entry: NoteEntry;
}

export async function getConfig(): Promise<Config> {
  return invoke<Config>("get_config");
}

export async function setWorkingDir(dir: string): Promise<void> {
  await invoke("set_working_dir", { dir });
}

export async function listNotes(dir: string): Promise<NoteEntry[]> {
  return invoke<NoteEntry[]>("list_notes", { dir });
}

export async function readNote(path: string): Promise<string> {
  return invoke<string>("read_note", { path });
}

export async function listProjects(root: string): Promise<ProjectEntry[]> {
  return invoke<ProjectEntry[]>("list_projects", { root });
}

/** Resolve an MRU list of project paths to the ones that still exist on disk,
 * preserving order. Backs the project switcher menu. */
export async function resolveProjects(paths: string[]): Promise<ProjectEntry[]> {
  return invoke<ProjectEntry[]>("resolve_projects", { paths });
}

/** Persist the recent-projects MRU list (without touching other config). */
export async function setRecentProjects(recent: string[]): Promise<void> {
  const config = await getConfig();
  await invoke("set_config", { newConfig: { ...config, recent_projects: recent } });
}

/** Persist the recent-documents MRU list (without touching other config). */
export async function setRecentDocuments(recent: string[]): Promise<void> {
  const config = await getConfig();
  await invoke("set_config", { newConfig: { ...config, recent_documents: recent } });
}

export async function createProject(root: string, name: string): Promise<ProjectEntry> {
  return invoke<ProjectEntry>("create_project", { root, name });
}

/** Resolve an MRU list of standalone-document paths to the ones still on disk,
 * preserving order. Mirrors `resolveProjects` for loose `.md` files. */
export async function resolveDocuments(paths: string[]): Promise<NoteEntry[]> {
  return invoke<NoteEntry[]>("resolve_documents", { paths });
}

/** Rename a project folder in place; returns the new path. */
export async function renameProject(dir: string, newName: string): Promise<string> {
  return invoke<string>("rename_project", { dir, newName });
}

/** Permanently delete a project folder. */
export async function deleteProject(dir: string): Promise<void> {
  await invoke("delete_project", { dir });
}

/** Delete a note file (piece or standalone document) plus its version history.
 * `dir` is the containing directory; `name` is the file stem. */
export async function deleteNote(dir: string, name: string): Promise<void> {
  await invoke("delete_note", { dir, name });
}

/** Create an empty standalone document at a user-chosen path via the OS save
 * dialog, returning the resulting entry. Used by the "new document" action.
 * The save panel is app-modal and runs above the always-on-top note window on
 * macOS, so we deliberately do NOT touch alwaysOnTop here — temporarily
 * lowering it strands the window if the user switches apps mid-dialog. */
export async function createDocument(): Promise<NoteEntry | null> {
  const target = await save({
    defaultPath: "未命名.md",
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!target) return null;
  // `save` does not auto-append the extension when the user omits it; force .md
  // so the file is recognized as a standalone document later.
  const path = /\.md$/i.test(target) ? target : `${target}.md`;
  await invoke("write_note", { path, content: "" });
  const name = path.split(/[\\/]/).pop()!.replace(/\.md$/i, "");
  return { name, path };
}

/** Native confirmation dialog (Tauri v2 disables `window.confirm`). Returns true
 * when the user accepts. Used by all delete flows. */
export async function confirmDialog(message: string, title = "确认"): Promise<boolean> {
  return confirm(message, { title, kind: "warning" });
}

export async function listPieces(projectDir: string): Promise<NoteEntry[]> {
  return invoke<NoteEntry[]>("list_pieces", { projectDir });
}

export async function createNote(dir: string): Promise<NoteEntry> {
  return invoke<NoteEntry>("create_note", { dir });
}

export async function renameNote(dir: string, oldName: string, newStem: string): Promise<string> {
  return invoke<string>("rename_note", { dir, oldName, newStem });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/** 有未保存修改的路径集合，用于外部文件变更时判断是否可以安全覆盖。 */
const dirtyPaths = new Set<string>();

export function scheduleSave(path: string, content: string) {
  dirtyPaths.add(path);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    invoke("write_note", { path, content })
      .then(() => dirtyPaths.delete(path))
      .catch((error) => {
        console.error("save failed", error);
        dirtyPaths.delete(path);
      });
  }, 500);
}

/** 某路径是否有未保存的本地修改（用于外部文件变更时决定是否覆盖编辑器）。 */
export function isDirty(path: string): boolean {
  return dirtyPaths.has(path);
}

export async function resolveStartDir(config: Config): Promise<string> {
  if (config.working_dir) return config.working_dir;
  const { homeDir } = await import("@tauri-apps/api/path");
  const dir = `${await homeDir()}/FloatNote`;
  await setWorkingDir(dir);
  return dir;
}

