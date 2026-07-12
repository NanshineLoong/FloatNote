import { invoke } from "@tauri-apps/api/core";
import { save, confirm, open } from "@tauri-apps/plugin-dialog";

/** read_note 命令返回：文件内容 + 磁盘 mtime（ms）。 */
interface NoteContent {
  content: string;
  mtime: number | null;
}

/** write_note 命令返回：是否冲突 + 写入后的新 mtime。 */
interface WriteOutcome {
  conflict: boolean;
  mtime: number | null;
}

export interface NoteEntry {
  name: string;
  path: string;
}

export interface ProjectEntry {
  name: string;
  path: string;
}

const INBOX_FILE = "_inbox.md";
const TASKS_FILE = "_tasks.md";

/** Join a project folder path with a child file, OS-correct separator. */
function projectFilePath(projectPath: string, file: string): string {
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
  return projectFilePath(projectPath, INBOX_FILE);
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
  shortcut_popup: string;
  auto_popup_mode: string;
  font_size: number;
  theme: "system" | "light" | "dark";
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

/** Patch config fields without touching the rest (read-merge-write). */
export async function updateConfig(patch: Partial<Config>): Promise<void> {
  const config = await getConfig();
  await invoke("set_config", { newConfig: { ...config, ...patch } });
}

export async function listNotes(dir: string): Promise<NoteEntry[]> {
  return invoke<NoteEntry[]>("list_notes", { dir });
}

async function readNote(path: string): Promise<NoteContent> {
  return invoke<NoteContent>("read_note", { path });
}

/** 读取笔记并登记 lastKnown mtime，返回内容。UI 加载/重载笔记统一走这里。 */
export async function loadNote(path: string): Promise<string> {
  const { content, mtime } = await readNote(path);
  lastKnown.set(path, mtime);
  return content;
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
  await updateConfig({ recent_projects: recent });
}

/** Persist the recent-documents MRU list (without touching other config). */
export async function setRecentDocuments(recent: string[]): Promise<void> {
  await updateConfig({ recent_documents: recent });
}

export async function createProject(root: string, name: string): Promise<ProjectEntry> {
  return invoke<ProjectEntry>("create_project", { root, name });
}

/** Open an existing folder as a project space. Ensures `_inbox.md` exists (the
 * backend scaffolds an empty one if missing; the folder itself is never
 * created). The backend also persists `working_dir` to the folder's parent. */
export async function openExistingProject(dir: string): Promise<ProjectEntry> {
  return invoke<ProjectEntry>("open_existing_project", { dir });
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
  await invoke("write_note", { path, content: "", expectedMtime: null });
  const name = path.split(/[\\/]/).pop()!.replace(/\.md$/i, "");
  return { name, path };
}

/** Pick an existing Markdown file via the OS open dialog and return it as a
 * standalone-document entry. The file is not created or modified — used by the
 * "open Markdown file" action in the document section's add submenu. */
export async function openDocumentFromFile(): Promise<NoteEntry | null> {
  const picked = await open({
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (typeof picked !== "string") return null;
  const name = picked.split(/[\\/]/).pop()!.replace(/\.md$/i, "");
  return { name, path: picked };
}

/** Native confirmation dialog (Tauri v2 disables `window.confirm`). Returns true
 * when the user accepts. Used by all delete flows. */
export async function confirmDialog(message: string, title = "确认"): Promise<boolean> {
  return confirm(message, { title, kind: "warning" });
}

export async function listPieces(projectDir: string): Promise<NoteEntry[]> {
  return invoke<NoteEntry[]>("list_pieces", { projectDir });
}

/** Create an empty note (piece or standalone document) in `dir`. Pass `title`
 * to give the file a meaningful stem from the start (sanitized server-side);
 * omit it to fall back to the legacy timestamp stem. */
export async function createNote(dir: string, title?: string): Promise<NoteEntry> {
  return invoke<NoteEntry>("create_note", { dir, title: title ?? null });
}

export async function renameNote(dir: string, oldName: string, newStem: string): Promise<string> {
  return invoke<string>("rename_note", { dir, oldName, newStem });
}

interface PendingWrite {
  content: string;
  timer: ReturnType<typeof setTimeout> | null;
  retry: number;
}

const pending = new Map<string, PendingWrite>();
/** 最近一次已知磁盘 mtime（ms），用于写入时做冲突守卫。 */
const lastKnown = new Map<string, number | null>();
let conflictHandler:
  | ((path: string, content: string) => void | Promise<void>)
  | null = null;

const DEBOUNCE_MS = 500;
const MAX_RETRIES = 3;
const BACKOFF_MS = [500, 1000, 2000];

/** 登记某路径最近一次已知的磁盘 mtime（读盘/AI 改写后调用）。 */
export function setLastKnown(path: string, mtime: number | null): void {
  lastKnown.set(path, mtime);
}

/** 某路径是否有未保存的本地修改（外部文件变更时决定是否安全覆盖）。 */
export function isDirty(path: string): boolean {
  return pending.has(path);
}

/** 注册冲突处理器：写盘检测到外部已改动时回调。 */
export function onConflict(
  handler: (path: string, content: string) => void | Promise<void>,
): void {
  conflictHandler = handler;
}

/** 丢弃某路径的待保存状态（用户选择"保留磁盘版本"后调用）。 */
export function discardPending(path: string): void {
  const entry = pending.get(path);
  if (entry?.timer) clearTimeout(entry.timer);
  pending.delete(path);
}

/** 排一次防抖写入：500ms 尾沿，per-path 独立计时。连续编辑合并为最后一次内容。 */
export function scheduleSave(path: string, content: string): void {
  const prev = pending.get(path);
  if (prev?.timer) clearTimeout(prev.timer);
  pending.set(path, { content, timer: null, retry: 0 });
  const entry = pending.get(path)!;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    void flushPath(path);
  }, DEBOUNCE_MS);
}

/** 立即写入（不经防抖计时）：tasks 面板与冲突"保留我的"用。 */
export async function saveImmediate(
  path: string,
  content: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  const prev = pending.get(path);
  if (prev?.timer) clearTimeout(prev.timer);
  pending.set(path, { content, timer: null, retry: 0 });
  await flushPath(path, opts.force === true);
}

/** 关闭/隐藏前清空所有待保存：立即触发每条 pending 的写入（fire-and-forget）。 */
export function flushAll(): void {
  for (const [path, entry] of pending) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    void flushPath(path);
  }
}

/** 执行一次写入：取 expectedMtime → invoke → 处理 conflict/重试/续写。 */
async function flushPath(path: string, force = false): Promise<void> {
  const entry = pending.get(path);
  if (!entry) return;
  const contentWritten = entry.content;
  const expectedMtime = force ? null : (lastKnown.get(path) ?? null);
  try {
    const outcome = await invoke<WriteOutcome>("write_note", {
      path,
      content: contentWritten,
      expectedMtime,
    });
    if (outcome.conflict) {
      if (conflictHandler) {
        await conflictHandler(path, contentWritten);
      } else {
        console.error("save conflict (no handler registered)", path);
      }
      return;
    }
    lastKnown.set(path, outcome.mtime);
    const cur = pending.get(path);
    if (!cur) return;
    if (cur.content === contentWritten) {
      pending.delete(path);
    } else {
      // 写入期间又来了新编辑 → 重新排一次防抖写，避免新内容滞留。
      cur.retry = 0;
      if (cur.timer) clearTimeout(cur.timer);
      cur.timer = setTimeout(() => {
        cur.timer = null;
        void flushPath(path);
      }, DEBOUNCE_MS);
    }
  } catch (error) {
    console.error("save failed", error);
    const cur = pending.get(path);
    if (!cur) return;
    if (cur.retry < MAX_RETRIES) {
      const backoff = BACKOFF_MS[cur.retry] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      cur.retry += 1;
      if (cur.timer) clearTimeout(cur.timer);
      cur.timer = setTimeout(() => {
        cur.timer = null;
        void flushPath(path, force);
      }, backoff);
    }
    // 重试耗尽：保留 pending，下次 scheduleSave 会重置 retry 续写。
  }
}

/** 测试专用：清空保存状态（清计时、pending、lastKnown、handler）。 */
export function __resetSaveStateForTests(): void {
  for (const [, entry] of pending) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  pending.clear();
  lastKnown.clear();
  conflictHandler = null;
}
