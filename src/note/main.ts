import "@phosphor-icons/web/regular";
import "../assistant/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { mountAssistant } from "../assistant/assistant";
import { agentSend, onAgentEvent, onNoteUpdated } from "./agent";
import { buildAppendInsert } from "./append";
import { appendToEnd, createEditor, setDoc } from "./editor";
import { createLayoutController } from "./layout-controller";
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
import { renderTitlebar, renderTopbar, setDirLabel, setNoteLabel } from "./topbar";
import { renderVersionBar } from "./version-bar";
import { listVersions, restoreVersion, snapshotNote } from "./versions";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <div id="titlebar-root"></div>
  <div id="topbar-root"></div>
  <div id="note-body">
    <div id="left-col"></div>
    <div id="editor-root"></div>
    <div id="right-col"><div id="assistant-region"></div></div>
  </div>
  <div id="version-root"></div>
`;

const noteBody = document.querySelector<HTMLElement>("#note-body")!;
const assistantRegion = document.querySelector<HTMLElement>("#assistant-region")!;

let current: CurrentNote | null = null;
let menuEl: HTMLElement | null = null;
/** AI 改写热刷新期间置位，避免编辑器变更回灌 autosave。 */
let applyingRemote = false;

const editorRoot = document.querySelector<HTMLElement>("#editor-root")!;
const editor = createEditor(editorRoot, (doc) => {
  if (applyingRemote) return;
  if (current) scheduleSave(current.entry.path, doc);
});
requestAnimationFrame(() => initScrollbar(editorRoot));

/** 用 AI/外部写入的新内容覆盖编辑器，不触发本地 autosave。 */
function applyRemoteDoc(content: string) {
  applyingRemote = true;
  setDoc(editor, content);
  applyingRemote = false;
}

mountAssistant(assistantRegion, {
  send: (text) => {
    if (!current) return;
    return agentSend({
      dir: current.dir,
      noteId: current.entry.name,
      path: current.entry.path,
      noteText: editor.state.doc.toString(),
      userText: text,
    });
  },
  subscribe: (cb) => onAgentEvent(cb),
});

void onNoteUpdated(async (payload) => {
  if (!current || payload.path !== current.entry.path) return;
  applyRemoteDoc(await readNote(current.entry.path));
});

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
  // 发布活动笔记，供独立助手窗 / apply_write 定位。
  void invoke("set_active_note", { dir, noteId: entry.name, path: entry.path });
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

// 布局控制器：按窗口宽度分级收缩边距、决定助手嵌入/分离（init() 里用配置初始化）。
let layoutController: ReturnType<typeof createLayoutController> | null = null;

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

// 标题栏（第一行）：左侧留给系统红绿灯、可拖拽，最右端助手 icon。
renderTitlebar(document.querySelector("#titlebar-root")!, {
  // 单击：开/关整个助手。
  onAssistantToggle: async () => {
    const next = await invoke<{ open: boolean; mode: string }>("toggle_assistant");
    layoutController?.setOpen(next.open);
  },
  // Option+单击：仅在重叠区切换嵌入/分离偏好。
  onAssistantModeSwitch: () => {
    if (!layoutController?.canToggle()) return;
    const mode = layoutController.toggleSticky();
    void invoke("set_assistant_mode", { mode });
  },
});

window.addEventListener("resize", () => layoutController?.apply());

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

  const assistant = await invoke<{ mode: string; open: boolean }>("get_assistant_state");
  layoutController = createLayoutController(app, {
    open: assistant.open,
    sticky: assistant.mode === "detached" ? "detached" : "embedded",
  });
  layoutController.apply();
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
  noteBody.prepend(banner);
});

