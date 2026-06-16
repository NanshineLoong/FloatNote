import "@phosphor-icons/web/regular";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { buildAppendInsert } from "./append";
import { appendToEnd, createEditor, setDoc } from "./editor";
import {
  createNote,
  getConfig,
  listNotes,
  readNote,
  renameNote,
  resolveStartDir,
  scheduleSave,
  setWorkingDir,
  type CurrentNote,
  type NoteEntry,
} from "./notes-state";
import { initScrollbar } from "./scrollbar";
import { renderTopbar, setDirLabel, setNoteLabel } from "./topbar";
import { renderVersionBar } from "./version-bar";
import { listVersions, restoreVersion, snapshotNote } from "./versions";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `<div id="topbar-root"></div><div id="editor-root"></div><div id="version-root"></div>`;

let current: CurrentNote | null = null;
let menuEl: HTMLElement | null = null;

const editorRoot = document.querySelector<HTMLElement>("#editor-root")!;
const editor = createEditor(editorRoot, (doc) => {
  if (current) scheduleSave(current.entry.path, doc);
});
requestAnimationFrame(() => initScrollbar(editorRoot));

function basename(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

async function openNote(dir: string, entry: NoteEntry) {
  current = { dir, entry };
  setDirLabel(basename(dir), dir);
  setNoteLabel(entry.name);
  setDoc(editor, await readNote(entry.path));
}

async function showSwitcher(anchor: HTMLElement) {
  if (menuEl) {
    closeMenu();
    return;
  }
  if (!current) return;

  const notes = await listNotes(current.dir);
  menuEl = document.createElement("div");
  menuEl.className = "switch-menu";
  const rect = anchor.getBoundingClientRect();
  menuEl.style.left = `${rect.left}px`;
  menuEl.style.top = `${rect.bottom + 2}px`;

  for (const note of notes) {
    const item = document.createElement("button");
    item.className = "switch-item";
    item.textContent = note.name;
    if (note.path === current.entry.path) item.classList.add("active");
    item.onclick = async () => {
      closeMenu();
      await openNote(current!.dir, note);
    };
    menuEl.appendChild(item);
  }

  document.body.appendChild(menuEl);
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
}

async function pickDir() {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  await setWorkingDir(picked);
  const notes = await listNotes(picked);
  const entry = notes[0] ?? (await createNote(picked));
  await openNote(picked, entry);
}

async function newNote() {
  if (!current) return;
  const entry = await createNote(current.dir);
  await openNote(current.dir, entry);
  editor.focus();
}

renderTopbar(document.querySelector("#topbar-root")!, {
  onPickDir: pickDir,
  onToggleMenu: (anchor) => {
    void showSwitcher(anchor);
  },
  onNew: () => {
    void newNote();
  },
  onRename: async (newName) => {
    if (!current) return;
    const newPath = await renameNote(current.dir, current.entry.name, newName);
    current.entry = { name: newName, path: newPath };
    setNoteLabel(newName);
  },
});

renderVersionBar(document.querySelector("#version-root")!, {
  loadVersions: () => (current ? listVersions(current.dir, current.entry.name) : Promise.resolve([])),
  onSnapshot: async () => {
    if (!current) return;
    await snapshotNote(current.dir, current.entry.name, editor.state.doc.toString(), "manual");
  },
  onRestore: async (v) => {
    if (!current) return;
    const restored = await restoreVersion(
      current.dir,
      current.entry.name,
      current.entry.path,
      editor.state.doc.toString(),
      v,
    );
    setDoc(editor, restored);
  },
});

const FONT_MIN = 10;
const FONT_MAX = 28;
let currentFontSize = 15;

function applyFontSize(size: number) {
  currentFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, size));
  document.documentElement.style.setProperty("--editor-font", `${currentFontSize}px`);
}

async function saveFontSize() {
  const config = await getConfig();
  await invoke("set_config", { newConfig: { ...config, font_size: currentFontSize } });
}

document.addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  if (e.key === "=" || e.key === "+") {
    e.preventDefault();
    applyFontSize(currentFontSize + 1);
    void saveFontSize();
  } else if (e.key === "-") {
    e.preventDefault();
    applyFontSize(currentFontSize - 1);
    void saveFontSize();
  }
});

async function init() {
  const config = await getConfig();
  applyFontSize(config.font_size);
  const dir = await resolveStartDir(config);
  setDirLabel(basename(dir), dir);
  const notes = await listNotes(dir);
  const entry = notes[0] ?? (await createNote(dir));
  await openNote(dir, entry);
}

void init();

void listen<string>("quote-captured", (event) => {
  const insert = buildAppendInsert(editor.state.doc.toString(), event.payload);
  appendToEnd(editor, insert);
  const pos = editor.state.doc.length;
  editor.dispatch({
    changes: { from: pos, insert: "\n" },
    selection: { anchor: pos + 1 },
    scrollIntoView: true,
  });
  editor.focus();
});

void listen("accessibility-needed", () => {
  if (document.querySelector("#a11y-banner")) return;
  const banner = document.createElement("div");
  banner.id = "a11y-banner";
  banner.textContent =
    "需要「辅助功能」权限才能抓取划线：系统设置 → 隐私与安全性 → 辅助功能，勾选 FloatNote 后重试。";
  banner.addEventListener("click", () => banner.remove());
  app.prepend(banner);
});

