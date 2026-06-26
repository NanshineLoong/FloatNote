import "@phosphor-icons/web/regular";
import "../assistant/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { mountAssistant } from "../assistant/assistant";
import { agentSend, onAgentEvent, onNoteUpdated } from "./agent";
import { buildAppendInsert } from "./append";
import { appendToEnd, createEditor, setDoc } from "./editor";
import { createInboxView } from "./blocks/view";
import { createLayoutController } from "./layout-controller";
import { createPieceSwitcher } from "./piece-switcher";
import { createTasksPanel } from "./tasks-panel";
import {
  createNote,
  createProject,
  getConfig,
  inboxEntry,
  listPieces,
  listProjects,
  readNote,
  resolveStartDir,
  scheduleSave,
  setWorkingDir,
  tasksPath,
  type CurrentNote,
  type NoteEntry,
  type ProjectEntry,
} from "./notes-state";
import { initScrollbar } from "./scrollbar";
import {
  pieceMount,
  renderTitlebar,
  renderTopbar,
  setDirLabel,
  setProjectLabel,
  setSourceToggle,
  setSplitToggle,
  setSurfaceSeg,
  setTasksToggle,
} from "./topbar";
import { renderVersionBar } from "./version-bar";
import { listVersions, restoreVersion, snapshotNote } from "./versions";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <div id="titlebar-root"></div>
  <div id="topbar-root"></div>
  <div id="note-body">
    <div id="left-col"></div>
    <div id="text-col">
      <div id="editor-root"></div>
      <div id="inbox-root"></div>
    </div>
    <div id="piece-col">
      <div id="piece-editor-root"></div>
    </div>
    <div id="assistant-region"></div>
  </div>
  <div id="version-root"></div>
`;

const noteBody = document.querySelector<HTMLElement>("#note-body")!;
const assistantRegion = document.querySelector<HTMLElement>("#assistant-region")!;

const DEFAULT_PROJECT_NAME = "阅读笔记";

let rootDir = "";
let currentProject: ProjectEntry | null = null;
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
editor.contentDOM.addEventListener("focus", () => publishInboxActive());

const inboxRoot = document.querySelector<HTMLElement>("#inbox-root")!;
const inboxView = createInboxView(inboxRoot, {
  // 卡片任何改动 → 重写整份 _inbox.md 到 CodeMirror（触发既有 autosave / 助手同步）。
  setDoc: (md) => setDoc(editor, md),
});

let inboxMode: "block" | "source" = "block";

function applyInboxMode() {
  app.classList.toggle("inbox-source", inboxMode === "source");
  setSourceToggle(inboxMode);
  if (inboxMode === "source") {
    editor.requestMeasure();
  } else {
    inboxView.render(editor.state.doc.toString());
  }
}

function toggleSource() {
  inboxMode = inboxMode === "block" ? "source" : "block";
  applyInboxMode();
}

// 布局控制器：按窗口宽度分级收缩边距、决定助手嵌入/分离/分屏（init() 里用配置初始化）。
let layoutController: ReturnType<typeof createLayoutController> | null = null;

// ── 成品 surface ──────────────────────────────────────────────────────────
const pieceEditorRoot = document.querySelector<HTMLElement>("#piece-editor-root")!;
let currentPiece: NoteEntry | null = null;

const pieceEditor = createEditor(pieceEditorRoot, (doc) => {
  if (applyingRemote) return;
  if (currentPiece) scheduleSave(currentPiece.path, doc);
});
requestAnimationFrame(() => initScrollbar(pieceEditorRoot));

// 焦点跟随：哪个 surface 获得焦点，助手 active_note 就指向它（成品=润色面）。
pieceEditor.contentDOM.addEventListener("focus", () => {
  if (currentProject && currentPiece) {
    void invoke("set_active_note", {
      dir: currentProject.path,
      noteId: currentPiece.name,
      path: currentPiece.path,
    });
  }
});

// 成品切换器挂载在顶栏的 #piece-mount 上 —— 该节点由下方 renderTopbar 创建，
// 故延迟到 renderTopbar 之后再 mount（见 mountPieceSwitcher）。
let pieceSwitcher: ReturnType<typeof createPieceSwitcher> | null = null;

function mountPieceSwitcher() {
  pieceSwitcher = createPieceSwitcher(pieceMount(), {
    dir: () => currentProject?.path ?? "",
    current: () => currentPiece,
    open: (entry) => void openPiece(entry),
  });
}

async function openPiece(entry: NoteEntry) {
  currentPiece = entry;
  pieceSwitcher?.setLabel(entry.name);
  applyingRemote = true;
  setDoc(pieceEditor, await readNote(entry.path));
  applyingRemote = false;
}

async function loadFirstPiece() {
  const dir = currentProject!.path;
  const pieces = await listPieces(dir);
  const first = pieces[0] ?? (await createNote(dir));
  await openPiece(first);
}

function publishInboxActive() {
  if (!currentProject || !current) return;
  void invoke("set_active_note", {
    dir: currentProject.path,
    noteId: current.entry.name,
    path: current.entry.path,
  });
}

// 单栏可见面 + 分屏请求。
type Surface = "inbox" | "piece";
let surface: Surface = "inbox";
let splitOn = false;

function applySurface() {
  const split = layoutController?.isSplit() ?? false;
  // 分屏时 Inbox 恒在左、成品恒在右；单栏时按 surface 选一个。
  app.classList.toggle("show-piece", !split && surface === "piece");
  app.classList.toggle("show-inbox", split || surface === "inbox");
  setSurfaceSeg(surface);
}

const tasksPanel = createTasksPanel(noteBody, {
  tasksPath: () => (currentProject ? tasksPath(currentProject.path) : null),
  onOpenChange: (open) => setTasksToggle(open),
});

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
  if (inboxMode === "block") inboxView.render(editor.state.doc.toString());
});

function basename(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

async function openProject(project: ProjectEntry) {
  currentProject = project;
  const entry = inboxEntry(project);
  current = { dir: project.path, entry };
  setProjectLabel(project.name);
  setDoc(editor, await readNote(entry.path));
  inboxView.render(editor.state.doc.toString());
  await loadFirstPiece();
  tasksPanel.reload();
  applySurface();
  // 发布活动笔记（= 当前项目的 _inbox.md），供独立助手窗 / apply_write 定位。
  void invoke("set_active_note", { dir: project.path, noteId: entry.name, path: entry.path });
}

async function openFirstOrCreate() {
  const projects = await listProjects(rootDir);
  const project = projects[0] ?? (await createProject(rootDir, DEFAULT_PROJECT_NAME));
  await openProject(project);
}

async function showProjectSwitcher(anchor: HTMLElement, startNew = false) {
  if (menuEl) {
    closeMenu();
    if (!startNew) return;
  }

  const projects = await listProjects(rootDir);
  menuEl = document.createElement("div");
  menuEl.className = "switch-menu";
  const rect = anchor.getBoundingClientRect();
  menuEl.style.left = `${rect.left}px`;
  menuEl.style.top = `${rect.bottom + 2}px`;

  for (const project of projects) {
    const item = document.createElement("button");
    item.className = "switch-item";
    item.textContent = project.name;
    if (currentProject && project.path === currentProject.path) item.classList.add("active");
    item.onclick = async () => {
      closeMenu();
      await openProject(project);
    };
    menuEl.appendChild(item);
  }

  const newItem = document.createElement("button");
  newItem.className = "switch-item switch-new";
  newItem.innerHTML = `<i class="ph ph-plus"></i> 新建项目`;
  newItem.onclick = (e) => {
    e.stopPropagation();
    startNewProject(newItem);
  };
  menuEl.appendChild(newItem);

  document.body.appendChild(menuEl);
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);

  if (startNew) startNewProject(newItem);
}

function startNewProject(item: HTMLElement) {
  const input = document.createElement("input");
  input.className = "switch-new-input";
  input.placeholder = "项目名称";
  item.replaceWith(input);
  input.focus();
  // 阻止"点击外部关闭"在自己的输入框上触发。
  input.addEventListener("click", (e) => e.stopPropagation());

  let submitting = false;
  async function confirm() {
    if (submitting) return;
    const name = input.value.trim();
    if (!name) {
      closeMenu();
      return;
    }
    submitting = true;
    const project = await createProject(rootDir, name);
    closeMenu();
    await openProject(project);
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void confirm(); }
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
  });
}

async function pickDir() {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  await setWorkingDir(picked);
  rootDir = picked;
  setDirLabel(basename(picked), picked);
  await openFirstOrCreate();
}

renderTopbar(document.querySelector("#topbar-root")!, {
  onPickDir: pickDir,
  onToggleProjects: (anchor) => {
    void showProjectSwitcher(anchor);
  },
  onNewProject: (anchor) => {
    void showProjectSwitcher(anchor, true);
  },
  onToggleSource: toggleSource,
  onSelectSurface: (next) => {
    surface = next;
    applySurface();
  },
  onToggleSplit: () => {
    splitOn = !splitOn;
    layoutController?.setSplit(splitOn);
    setSplitToggle(layoutController?.isSplit() ?? false);
    applySurface();
  },
  onToggleTasks: () => tasksPanel.toggle(),
});

// 顶栏已渲染出 #piece-mount，现在挂载成品切换器。
mountPieceSwitcher();

// 标题栏（第一行）：左侧留给系统红绿灯、可拖拽，最右端助手 icon。
renderTitlebar(document.querySelector("#titlebar-root")!, {
  // 单击：开/关整个助手。
  onAssistantToggle: async () => {
    const next = await invoke<{ open: boolean }>("toggle_assistant");
    layoutController?.setOpen(next.open);
  },
});

// resize 过渡门控：连续拖拽（事件间隔 <120ms）时关掉过渡保证不卡顿；
// 离散跳变（双击标题栏放大、开关助手）是孤立事件，保留过渡 → 平滑动画。
let lastResize = 0;
let resizeSettle: number | undefined;
window.addEventListener("resize", () => {
  const now = performance.now();
  const continuous = now - lastResize < 120;
  lastResize = now;
  noteBody.classList.toggle("resizing", continuous);
  layoutController?.apply();
  setSplitToggle(layoutController?.isSplit() ?? false);
  applySurface();
  if (resizeSettle) clearTimeout(resizeSettle);
  resizeSettle = window.setTimeout(() => noteBody.classList.remove("resizing"), 180);
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
  rootDir = await resolveStartDir(config);
  setDirLabel(basename(rootDir), rootDir);
  await openFirstOrCreate();

  const assistant = await invoke<{ open: boolean }>("get_assistant_state");
  layoutController = createLayoutController(app, { open: assistant.open });
  layoutController.apply();
  applyInboxMode();
  applySurface();
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
  if (inboxMode === "block") {
    inboxView.render(editor.state.doc.toString());
  } else {
    editor.focus();
  }
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

