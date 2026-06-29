import { invoke } from "@tauri-apps/api/core";

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

export async function createProject(root: string, name: string): Promise<ProjectEntry> {
  return invoke<ProjectEntry>("create_project", { root, name });
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

