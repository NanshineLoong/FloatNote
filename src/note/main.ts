import "@phosphor-icons/web/regular";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { buildAppendInsert } from "./append";
import { appendToEnd, createEditor, setDoc } from "./editor";
import {
  createNote,
  getConfig,
  listNotes,
  readNote,
  resolveStartDir,
  scheduleSave,
  setWorkingDir,
  type CurrentNote,
  type NoteEntry,
} from "./notes-state";
import { initScrollbar } from "./scrollbar";
import { renderTopbar, setDirLabel, setNoteLabel } from "./topbar";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `<div id="topbar-root"></div><div id="editor-root"></div>`;

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
});

async function init() {
  const config = await getConfig();
  document.documentElement.style.setProperty("--editor-font", `${config.font_size}px`);
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

