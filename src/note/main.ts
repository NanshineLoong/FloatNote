import "@phosphor-icons/web/regular";
import "../assistant/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { mountAssistant } from "../assistant/assistant";
import { agentSend, onAgentEvent, onFileChanged, onNoteUpdated } from "./agent";
import { buildAppendInsert } from "./append";
import { placeholder } from "@codemirror/view";
import { appendToEnd, createEditor, requestEditorLayout, setDoc } from "./editor";
import { blockHandleGutter } from "./blocks/handle-gutter";
import { createLayoutController } from "./layout-controller";
import { createPieceHeader } from "./piece-switcher";
import { createTasksPanel } from "./tasks-panel";
import {
  createNote,
  createProject,
  getConfig,
  inboxEntry,
  isDirty,
  listPieces,
  listProjects,
  readNote,
  resolveProjects,
  resolveStartDir,
  scheduleSave,
  setRecentProjects,
  tasksPath,
  type CurrentNote,
  type NoteEntry,
  type ProjectEntry,
} from "./notes-state";
import { parentDir, pushRecent } from "./recent-projects";
import { initScrollbar } from "./scrollbar";
import {
  renderTitlebar,
  renderTopbar,
  setProjectLabel,
  setTasksToggle,
  setViewSeg,
} from "./topbar";
import { canSplit } from "./split";
import { listVersions, restoreVersion, snapshotNote } from "./versions";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <div id="titlebar-root"></div>
  <div id="topbar-root"></div>
  <div id="note-body">
    <div id="left-col"></div>
    <div id="text-col">
      <div id="editor-root"></div>
    </div>
    <div id="piece-col">
      <div id="piece-scroll">
        <div id="piece-doc-header"></div>
        <div id="piece-editor-root"></div>
      </div>
    </div>
    <div id="assistant-region"></div>
  </div>
`;

const noteBody = document.querySelector<HTMLElement>("#note-body")!;
const assistantRegion = document.querySelector<HTMLElement>("#assistant-region")!;

const DEFAULT_PROJECT_NAME = "阅读笔记";

/** 最近打开的项目路径（MRU，最近在前，上限 8）。项目可散落在磁盘任意位置，
 * 此列表是项目切换菜单的唯一数据来源，并持久化到 config.recent_projects。 */
let recent: string[] = [];
let currentProject: ProjectEntry | null = null;
let current: CurrentNote | null = null;
let menuEl: HTMLElement | null = null;
/** The project-name button the switcher menu is anchored to (for repositioning). */
let menuAnchor: HTMLElement | null = null;
/** AI 改写热刷新期间置位，避免编辑器变更回灌 autosave。 */
let applyingRemote = false;

const editorRoot = document.querySelector<HTMLElement>("#editor-root")!;
// Inbox 是常驻、可直接编辑的 block 面（live preview）。每个 top-level block 在左侧
// gutter 上有一个句柄：拖拽重排 / 单击弹菜单。无独立卡片视图、无源码切换。
const editor = createEditor(
  editorRoot,
  (doc) => {
    if (applyingRemote) return;
    if (current) scheduleSave(current.entry.path, doc);
  },
  [
    blockHandleGutter(),
    placeholder("Inbox 还是空的 —— 划线捕获或在这里写点什么"),
  ],
);
requestAnimationFrame(() => initScrollbar(editorRoot));
editor.contentDOM.addEventListener("focus", () => publishInboxActive());

// 布局控制器：按窗口宽度分级收缩边距、决定助手嵌入/分离/分屏（init() 里用配置初始化）。
let layoutController: ReturnType<typeof createLayoutController> | null = null;

// ── 成品 surface ──────────────────────────────────────────────────────────
const pieceEditorRoot = document.querySelector<HTMLElement>("#piece-editor-root")!;
const pieceCol = document.querySelector<HTMLElement>("#piece-col")!;
const pieceScroll = document.querySelector<HTMLElement>("#piece-scroll")!;
let currentPiece: NoteEntry | null = null;

// grow:true → 编辑器长到内容高度、不自带内部滚动，于是标题与正文共用 #piece-scroll
// 这一个外层滚动容器（Notion 式：标题随正文一起滚）。
const pieceEditor = createEditor(
  pieceEditorRoot,
  (doc) => {
    if (applyingRemote) return;
    if (currentPiece) scheduleSave(currentPiece.path, doc);
  },
  [],
  { grow: true },
);
// 滑块挂在不滚动的 #piece-col 上，监听真正滚动的 #piece-scroll。
requestAnimationFrame(() => initScrollbar(pieceCol, pieceScroll));

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

// 文档头（标题 + 切换箭头）挂在「写作」栏内容区顶部，随正文一起滚。
let pieceHeader: ReturnType<typeof createPieceHeader> | null = null;

function mountPieceHeader() {
  const header = document.querySelector<HTMLElement>("#piece-doc-header")!;
  pieceHeader = createPieceHeader(header, {
    dir: () => currentProject?.path ?? "",
    current: () => currentPiece,
    open: (entry) => void openPiece(entry),
    loadVersions: () =>
      currentProject && currentPiece
        ? listVersions(currentProject.path, currentPiece.name)
        : Promise.resolve([]),
    snapshot: async () => {
      if (!currentProject || !currentPiece) return;
      await snapshotNote(
        currentProject.path,
        currentPiece.name,
        pieceEditor.state.doc.toString(),
        "manual",
      );
    },
    restore: async (v) => {
      if (!currentProject || !currentPiece) return;
      const restored = await restoreVersion(
        currentProject.path,
        currentPiece.name,
        currentPiece.path,
        pieceEditor.state.doc.toString(),
        v,
      );
      applyingRemote = true;
      setDoc(pieceEditor, restored);
      applyingRemote = false;
    },
  });
}

async function openPiece(entry: NoteEntry) {
  currentPiece = entry;
  pieceHeader?.setLabel(entry.name);
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

// 单栏可见面（采集/写作）。双栏由 layoutController 持有；surface 始终记着「上次的
// 单栏面」，作为窗口变窄、双栏放不下时的回落目标。
type Surface = "inbox" | "piece";
let surface: Surface = "inbox";

function applyView() {
  const split = layoutController?.isSplit() ?? false;
  // 双栏时采集恒在左、写作恒在右；单栏时按 surface 选一个。
  app.classList.toggle("show-piece", !split && surface === "piece");
  app.classList.toggle("show-inbox", split || surface === "inbox");
  setViewSeg(split ? "split" : surface, canSplit(window.innerWidth));
  requestEditorLayout(editor);
  requestEditorLayout(pieceEditor);
}

const tasksPanel = createTasksPanel(noteBody, {
  tasksPath: () => (currentProject ? tasksPath(currentProject.path) : null),
  // 行动开关与助手开关同等地驱动右栏几何：打开即预留右栏、正文左推。
  onOpenChange: (open) => {
    setTasksToggle(open);
    layoutController?.setActionOpen(open);
  },
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
});

// 外部文件修改：Rust watcher 检测到 .md 文件变化后广播，热刷新对应编辑器。
// 如果编辑器有未保存的本地修改（用户正在输入），跳过刷新以避免丢失输入。
void onFileChanged(async (changedPath) => {
  if (isDirty(changedPath)) return;

  // Inbox 被外部修改。
  if (current && changedPath === current.entry.path) {
    applyRemoteDoc(await readNote(current.entry.path));
    return;
  }
  // 成品（piece）被外部修改。
  if (currentPiece && changedPath === currentPiece.path) {
    applyingRemote = true;
    setDoc(pieceEditor, await readNote(currentPiece.path));
    applyingRemote = false;
    return;
  }
  // 行动（_tasks.md）被外部修改。
  if (currentProject && changedPath === tasksPath(currentProject.path)) {
    tasksPanel.reload();
    return;
  }
});

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

/** Record a project as most-recently-used and persist the capped MRU list. */
async function rememberProject(path: string) {
  recent = pushRecent(recent, path);
  await setRecentProjects(recent);
}

async function openProject(project: ProjectEntry) {
  currentProject = project;
  await rememberProject(project.path);
  const entry = inboxEntry(project);
  current = { dir: project.path, entry };
  setProjectLabel(project.name);
  setDoc(editor, await readNote(entry.path));
  await loadFirstPiece();
  tasksPanel.reload();
  applyView();
  // 发布活动笔记（= 当前项目的 _inbox.md），供独立助手窗 / apply_write 定位。
  void invoke("set_active_note", { dir: project.path, noteId: entry.name, path: entry.path });
  // 切换文件监听到新项目目录。
  void invoke("watch_dir", { dir: project.path });
}

/** 启动时打开项目：优先 MRU 列表里仍存在的第一个；否则回退到旧的工作目录
 * 扫描（迁移老用户的现有项目），都没有就在工作目录下建一个默认项目。 */
async function bootstrapProjects(config: Awaited<ReturnType<typeof getConfig>>) {
  recent = config.recent_projects ?? [];
  const existing = await resolveProjects(recent);
  if (existing[0]) {
    recent = existing.map((project) => project.path);
    await openProject(existing[0]);
    return;
  }
  const startDir = await resolveStartDir(config);
  const projects = await listProjects(startDir);
  const project = projects[0] ?? (await createProject(startDir, DEFAULT_PROJECT_NAME));
  await openProject(project);
}

async function showProjectSwitcher(anchor: HTMLElement) {
  if (menuEl) {
    closeMenu();
    return;
  }

  const projects = await resolveProjects(recent);
  menuAnchor = anchor;
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

  // 在当前项目的同级目录新建。
  addNewProjectEntry(`<i class="ph ph-plus"></i> 在当前目录新建`, () =>
    currentProject ? parentDir(currentProject.path) : null,
  );
  // 弹系统文件夹选择器，在任意位置的某个父目录下新建。
  addNewProjectEntry(`<i class="ph ph-folder-open"></i> 选择位置新建…`, async () => {
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === "string" ? picked : null;
  });

  document.body.appendChild(menuEl);
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
}

/** Append a "new project" menu entry that, when clicked, resolves a parent
 * directory via `getParent` and then swaps itself for an inline name input. */
function addNewProjectEntry(label: string, getParent: () => string | null | Promise<string | null>) {
  if (!menuEl) return;
  const item = document.createElement("button");
  item.className = "switch-item switch-new";
  item.innerHTML = label;
  item.onclick = async (e) => {
    e.stopPropagation();
    const parent = await getParent();
    if (!parent) {
      closeMenu();
      return;
    }
    // “选择位置”可能弹了原生对话框使菜单已被外部点击关闭，重建一个最小输入态。
    if (!menuEl && menuAnchor) {
      menuEl = document.createElement("div");
      menuEl.className = "switch-menu";
      const rect = menuAnchor.getBoundingClientRect();
      menuEl.style.left = `${rect.left}px`;
      menuEl.style.top = `${rect.bottom + 2}px`;
      document.body.appendChild(menuEl);
      setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
      promptNewProjectName(menuEl, parent);
      return;
    }
    promptNewProjectName(item, parent);
  };
  menuEl.appendChild(item);
}

/** Replace `host` (a menu item) — or append to it, if it is the menu — with an
 * inline input that creates a project under `parent` on Enter. */
function promptNewProjectName(host: HTMLElement, parent: string) {
  const input = document.createElement("input");
  input.className = "switch-new-input";
  input.placeholder = "项目名称";
  if (host === menuEl) host.appendChild(input);
  else host.replaceWith(input);
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
    const project = await createProject(parent, name);
    closeMenu();
    await openProject(project);
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); void confirm(); }
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); }
  });
}

renderTopbar(document.querySelector("#topbar-root")!, {
  onToggleProjects: (anchor) => {
    void showProjectSwitcher(anchor);
  },
  onSelectView: (view) => {
    if (view === "split") {
      layoutController?.setSplit(true);
    } else {
      // 选中采集/写作即退出双栏，并记住这一面作为回落目标。
      surface = view;
      layoutController?.setSplit(false);
    }
    applyView();
    tasksPanel.syncLayout();
  },
  onToggleTasks: () => tasksPanel.toggle(),
});

// #piece-doc-header 已在 app.innerHTML 中就位，挂载文档头到「写作」栏顶部。
mountPieceHeader();

// 标题栏（第一行）：左侧留给系统红绿灯、可拖拽，最右端助手 icon。
renderTitlebar(document.querySelector("#titlebar-root")!, {
  // 单击：开/关整个助手。
  onAssistantToggle: async () => {
    const next = await invoke<{ open: boolean }>("toggle_assistant");
    layoutController?.setAssistantOpen(next.open);
    tasksPanel.syncLayout();
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
  applyView();
  tasksPanel.syncLayout();
  if (resizeSettle) clearTimeout(resizeSettle);
  resizeSettle = window.setTimeout(() => noteBody.classList.remove("resizing"), 180);
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
  await bootstrapProjects(config);

  const assistant = await invoke<{ open: boolean }>("get_assistant_state");
  layoutController = createLayoutController(app, { assistantOpen: assistant.open });
  layoutController.apply();
  applyView();
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
