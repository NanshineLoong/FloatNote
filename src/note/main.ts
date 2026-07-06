import "@phosphor-icons/web/regular";
import "../assistant/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { mountAssistant, type AssistantHandle } from "../assistant/assistant";
import { agentSend, onAgentEvent, onFileChanged, onNoteUpdated } from "./agent";
import { buildCaretInsert } from "./append";
import { buildQuoteBlock, mergeQuoteBlock, resolveMergeTarget, type Source } from "./quote";
import { htmlToMarkdown } from "./paste";
import { EditorView, placeholder } from "@codemirror/view";
import { createEditor, insertAtCaret, requestEditorLayout, setDoc } from "./editor";
import { blockHandleGutter, deleteBlock } from "./blocks/handle-gutter";
import { cancelBlockDrag, scrollerPositionTheme } from "./blocks/drag";
import { mountTagBar } from "./tags/bar";
import { tagDecorations } from "./tags/decoration";
import { tagFilter, setTagFilter } from "./tags/filter";
import { openBlockTagMenu } from "./tags/picker";
import { createLayoutController } from "./layout-controller";
import { createPieceHeader } from "./piece-switcher";
import { createTasksPanel } from "./tasks-panel";
import {
  createDocument,
  createNote,
  createProject,
  confirmDialog,
  deleteNote,
  deleteProject,
  getConfig,
  inboxEntry,
  isDirty,
  listPieces,
  listProjects,
  readNote,
  renameNote,
  renameProject,
  resolveDocuments,
  resolveProjects,
  resolveStartDir,
  scheduleSave,
  setRecentDocuments,
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
    <div id="tag-bar-root"></div>
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
/** 最近打开的独立文档路径（MRU，与 recent 平行）。持久化到 config.recent_documents。 */
let recentDocs: string[] = [];
let currentProject: ProjectEntry | null = null;
let current: CurrentNote | null = null;
/** 当前窗口模式：项目（含采集/写作/双栏）或独立文档（单一编辑器，无滑拨杆）。 */
let mode: "project" | "document" = "project";
/** 文档模式下打开的独立文档；项目模式下为 null。复用 pieceEditor 渲染。 */
let currentDocument: NoteEntry | null = null;
let menuEl: HTMLElement | null = null;
/** The project-name button the switcher menu is anchored to (for repositioning). */
let menuAnchor: HTMLElement | null = null;
/** AI 改写热刷新期间置位，避免编辑器变更回灌 autosave。 */
let applyingRemote = false;

const editorRoot = document.querySelector<HTMLElement>("#editor-root")!;
// Inbox 是常驻、可直接编辑的 block 面（live preview）。每个 top-level block 在左侧
// gutter 上有一个句柄：拖拽重排 / 单击弹菜单。无独立卡片视图、无源码切换。
// 标签：句柄左键菜单直接分配/新建标签；decoration 隐藏注释+给块上底色；filter 折叠不匹配块。
// tagBar 挂在正文网格顶行，updateListener 经由闭包变量迟到绑定。
let tagBar: { el: HTMLElement; refresh: () => void } | null = null;
const editor = createEditor(
  editorRoot,
  (doc) => {
    if (applyingRemote) return;
    if (current) scheduleSave(current.entry.path, doc);
  },
  [
    blockHandleGutter(
      {
        getPieceView: () => pieceEditor,
        isSplitActive: () => layoutController?.isSplit() ?? false,
        textColEl: document.querySelector<HTMLElement>("#text-col")!,
        pieceColEl: document.querySelector<HTMLElement>("#piece-col")!,
      },
      (view, range, _index, x, y) => {
        openBlockTagMenu(view, range, x, y, () => deleteBlock(view, range));
      },
    ),
    tagDecorations(),
    ...tagFilter(),
    placeholder("Inbox 还是空的 —— 划线捕获或在这里写点什么"),
    EditorView.updateListener.of((u) => {
      if (tagBar && (u.docChanged ||
        u.transactions.some((t) => t.effects.some((e) => e.is(setTagFilter))))) {
        tagBar.refresh();
      }
    }),
  ],
);
// 二级标签栏挂在采集区网格顶行（不在全局顶栏，也不受正文列宽限制）。
tagBar = mountTagBar(editor);
document.querySelector<HTMLElement>("#tag-bar-root")!.appendChild(tagBar.el);
requestAnimationFrame(() => initScrollbar(editorRoot));
editor.contentDOM.addEventListener("focus", () => publishInboxActive());

// 布局控制器：按窗口宽度分级收缩边距、决定助手嵌入/分离/分屏（init() 里用配置初始化）。
let layoutController: ReturnType<typeof createLayoutController> | null = null;

// ── 成品 surface ──────────────────────────────────────────────────────────
const pieceEditorRoot = document.querySelector<HTMLElement>("#piece-editor-root")!;
const pieceCol = document.querySelector<HTMLElement>("#piece-col")!;
const pieceScroll = document.querySelector<HTMLElement>("#piece-scroll")!;
let currentPiece: NoteEntry | null = null;

/** 当前装载进 pieceEditor 的文件（项目模式=成品，文档模式=独立文档）。 */
function activePieceFile(): NoteEntry | null {
  return mode === "document" ? currentDocument : currentPiece;
}

// grow:true → 编辑器长到内容高度、不自带内部滚动，于是标题与正文共用 #piece-scroll
// 这一个外层滚动容器（Notion 式：标题随正文一起滚）。
const pieceEditor = createEditor(
  pieceEditorRoot,
  (doc) => {
    if (applyingRemote) return;
    const f = activePieceFile();
    if (f) scheduleSave(f.path, doc);
  },
  [scrollerPositionTheme],
  { grow: true },
);
// 滑块挂在不滚动的 #piece-col 上，监听真正滚动的 #piece-scroll。
requestAnimationFrame(() => initScrollbar(pieceCol, pieceScroll));

// 焦点跟随：哪个 surface 获得焦点，助手 active_note 就指向它（成品=润色面）。
pieceEditor.contentDOM.addEventListener("focus", () => {
  const f = activePieceFile();
  if (!f) return;
  const dir = mode === "document" ? parentDir(f.path) : currentProject?.path;
  if (!dir) return;
  void invoke("set_active_note", { dir, noteId: f.name, path: f.path });
});

// 文档头（标题 + 切换箭头）挂在「写作」栏内容区顶部，随正文一起滚。
let pieceHeader: ReturnType<typeof createPieceHeader> | null = null;

function mountPieceHeader() {
  const header = document.querySelector<HTMLElement>("#piece-doc-header")!;
  pieceHeader = createPieceHeader(header, {
    dir: () =>
      mode === "document"
        ? currentDocument
          ? parentDir(currentDocument.path)
          : ""
        : currentProject?.path ?? "",
    current: () => activePieceFile(),
    open: (entry) => {
      if (mode === "document") {
        // 文档模式下 open 仅在重命名后被调用：更新当前文档引用并同步 MRU 路径。
        const oldPath = currentDocument?.path;
        currentDocument = entry;
        pieceHeader?.setLabel(entry.name);
        if (oldPath && oldPath !== entry.path) {
          recentDocs = recentDocs.map((p) => (p === oldPath ? entry.path : p));
          void setRecentDocuments(recentDocs);
        }
      } else {
        void openPiece(entry);
      }
    },
    loadVersions: () => {
      if (mode !== "project" || !currentProject || !currentPiece)
        return Promise.resolve([]);
      return listVersions(currentProject.path, currentPiece.name);
    },
    snapshot: async () => {
      if (mode !== "project" || !currentProject || !currentPiece) return;
      await snapshotNote(
        currentProject.path,
        currentPiece.name,
        pieceEditor.state.doc.toString(),
        "manual",
      );
    },
    restore: async (v) => {
      if (mode !== "project" || !currentProject || !currentPiece) return;
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
    onDelete: () => deleteCurrentDocument(),
  });
}

async function openPiece(entry: NoteEntry) {
  currentPiece = entry;
  pieceHeader?.setLabel(entry.name);
  applyingRemote = true;
  setDoc(pieceEditor, await readNote(entry.path));
  applyingRemote = false;
}

/** 打开一个独立文档：切到文档模式，复用 pieceEditor 渲染该文件。 */
async function openDocument(doc: NoteEntry) {
  mode = "document";
  currentDocument = doc;
  recentDocs = pushRecent(recentDocs, doc.path);
  await setRecentDocuments(recentDocs);
  setProjectLabel(doc.name);
  applyingRemote = true;
  setDoc(pieceEditor, await readNote(doc.path));
  applyingRemote = false;
  pieceHeader?.setLabel(doc.name);
  applyView();
  void invoke("set_active_note", { dir: parentDir(doc.path), noteId: doc.name, path: doc.path });
  // 独立文档不在项目目录内，停掉文件监听以免误刷新（返回项目时再 watch_dir）。
  void invoke("unwatch_dir");
}

/** 删除当前独立文档并返回到上一个项目（或弹出切换菜单）。 */
async function deleteCurrentDocument() {
  if (mode !== "document" || !currentDocument) return;
  const target = currentDocument;
  if (!(await confirmDialog(`删除文档「${target.name}」？它会被移到废纸篓。`))) return;
  try {
    await deleteNote(parentDir(target.path), target.name);
  } catch (err) {
    console.error("delete document failed", err);
    return;
  }
  recentDocs = recentDocs.filter((p) => p !== target.path);
  await setRecentDocuments(recentDocs);
  currentDocument = null;
  // 回到上一个项目；若不可用则弹切换菜单。
  if (currentProject) {
    try {
      await openProject(currentProject);
      return;
    } catch (err) {
      console.error("return to project failed", err);
    }
  }
  const anchor = document.querySelector<HTMLElement>("#project-name");
  if (anchor) void showProjectSwitcher(anchor);
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
  // 文档模式：单一编辑器，无滑拨杆 / 无采集面 / 无行动面板（CSS 经 .doc-mode 隐藏）。
  app.classList.toggle("doc-mode", mode === "document");
  if (mode === "document") {
    app.classList.add("show-piece");
    app.classList.remove("show-inbox");
    setViewSeg("piece", false);
    requestEditorLayout(editor);
    requestEditorLayout(pieceEditor);
    return;
  }
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

const assistantHandle: AssistantHandle = mountAssistant(assistantRegion, {
  send: (text) => {
    // 文档模式：助手作用于当前独立文档；项目模式：作用于采集面（_inbox）。
    if (mode === "document") {
      if (!currentDocument) throw new Error("当前没有打开的文档，请稍后再试");
      return agentSend({
        dir: parentDir(currentDocument.path),
        noteId: currentDocument.name,
        path: currentDocument.path,
        noteText: pieceEditor.state.doc.toString(),
        userText: text,
      });
    }
    if (!current) throw new Error("当前没有打开的笔记，请稍后再试");
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
  // 采集面（项目模式）被 AI 改写。
  if (current && payload.path === current.entry.path) {
    applyRemoteDoc(await readNote(current.entry.path));
    return;
  }
  // 成品 / 独立文档被 AI 改写（文档模式无文件监听，靠这条热刷新）。
  const f = activePieceFile();
  if (f && payload.path === f.path) {
    applyingRemote = true;
    setDoc(pieceEditor, await readNote(f.path));
    applyingRemote = false;
  }
});

// 外部文件修改：Rust watcher 检测到 .md 文件变化后广播，热刷新对应编辑器。
// 如果编辑器有未保存的本地修改（用户正在输入），跳过刷新以避免丢失输入。
void onFileChanged(async (changedPath) => {
  if (isDirty(changedPath)) return;

  // 拖拽进行中若目标文档被外部改写，落点偏移会失效 —— 直接中止拖拽不提交。
  const activeFile = activePieceFile();
  if (
    (current && changedPath === current.entry.path) ||
    (activeFile && changedPath === activeFile.path)
  ) {
    cancelBlockDrag();
  }

  // Inbox 被外部修改。
  if (current && changedPath === current.entry.path) {
    applyRemoteDoc(await readNote(current.entry.path));
    return;
  }
  // 成品（piece）或独立文档被外部修改。
  if (activeFile && changedPath === activeFile.path) {
    applyingRemote = true;
    setDoc(pieceEditor, await readNote(activeFile.path));
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

/** Record a standalone document as most-recently-used and persist the MRU list. */
async function rememberDocument(path: string) {
  recentDocs = pushRecent(recentDocs, path);
  await setRecentDocuments(recentDocs);
}

async function openProject(project: ProjectEntry) {
  mode = "project";
  currentDocument = null;
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
  recentDocs = config.recent_documents ?? [];
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

  const [projects, documents] = await Promise.all([
    resolveProjects(recent),
    resolveDocuments(recentDocs),
  ]);
  // 顺手把已不存在的路径从 MRU 里清掉（resolve 已经过滤，这里同步内存列表）。
  recent = projects.map((p) => p.path);
  recentDocs = documents.map((d) => d.path);

  menuAnchor = anchor;
  menuEl = document.createElement("div");
  menuEl.className = "switch-menu";
  const rect = anchor.getBoundingClientRect();
  menuEl.style.left = `${rect.left}px`;
  menuEl.style.top = `${rect.bottom + 2}px`;

  // ── 项目区 ──
  if (projects.length > 0) {
    menuEl.appendChild(sectionHeader("ph-folder", "项目"));
    for (const project of projects) {
      menuEl.appendChild(
        makeSwitcherRow({
          label: project.name,
          icon: "ph-folder",
          active: mode === "project" && currentProject?.path === project.path,
          onOpen: () => {
            closeMenu();
            void openProject(project);
          },
          onRename: (host) =>
            void promptRename(host, project.name, async (name) => {
              const newPath = await renameProject(project.path, name);
              recent = recent.map((p) => (p === project.path ? newPath : p));
              await setRecentProjects(recent);
              if (mode === "project" && currentProject?.path === project.path) {
                currentProject = { name, path: newPath };
                setProjectLabel(name);
              }
            }),
          onDelete: () => void deleteProjectFlow(project),
        }),
      );
    }
  }

  // ── 文档区 ──
  if (documents.length > 0) {
    menuEl.appendChild(sectionHeader("ph-file", "文档"));
    for (const doc of documents) {
      menuEl.appendChild(
        makeSwitcherRow({
          label: doc.name,
          icon: "ph-file",
          active: mode === "document" && currentDocument?.path === doc.path,
          onOpen: () => {
            closeMenu();
            void openDocument(doc);
          },
          onRename: (host) =>
            void promptRename(host, doc.name, async (name) => {
              const newPath = await renameNote(parentDir(doc.path), doc.name, name);
              recentDocs = recentDocs.map((p) => (p === doc.path ? newPath : p));
              await setRecentDocuments(recentDocs);
              if (mode === "document" && currentDocument?.path === doc.path) {
                currentDocument = { name, path: newPath };
                setProjectLabel(name);
                pieceHeader?.setLabel(name);
              }
            }),
          onDelete: () => void deleteDocumentFlow(doc),
        }),
      );
    }
  }

  // ── 新建 ──
  // 在当前项目的同级目录新建。
  addNewProjectEntry(`<i class="ph ph-plus"></i> 在当前目录新建项目`, () =>
    currentProject ? parentDir(currentProject.path) : null,
  );
  // 弹系统文件夹选择器，在任意位置的某个父目录下新建。
  addNewProjectEntry(`<i class="ph ph-folder-open"></i> 选择位置新建项目…`, async () => {
    const picked = await open({ directory: true, multiple: false });
    return typeof picked === "string" ? picked : null;
  });
  addNewDocumentEntry();

  document.body.appendChild(menuEl);
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
}

/** 区块标题（项目 / 文档），左侧 Phosphor 图标 + 文字。 */
function sectionHeader(icon: string, label: string): HTMLElement {
  const h = document.createElement("div");
  h.className = "switch-section";
  h.innerHTML = `<i class="ph ${icon}"></i><span>${label}</span>`;
  return h;
}

interface SwitcherRowOpts {
  label: string;
  icon: string;
  active?: boolean;
  onOpen: () => void;
  onRename: (host: HTMLElement) => void;
  onDelete: () => void;
}

/** 切换菜单的一行：左侧标签（点击打开），右侧悬停露出重命名 / 删除。
 * 行体是 div（而非 button），避免 button-in-button 嵌套。 */
function makeSwitcherRow(opts: SwitcherRowOpts): HTMLElement {
  const row = document.createElement("div");
  row.className = "switch-row";
  if (opts.active) row.classList.add("active");

  const label = document.createElement("button");
  label.className = "switch-row-label";
  label.innerHTML = `<i class="ph ${opts.icon}"></i><span class="switch-row-name">${opts.label}</span>`;
  label.onclick = (e) => {
    e.stopPropagation();
    opts.onOpen();
  };

  const renameBtn = document.createElement("button");
  renameBtn.className = "switch-row-action";
  renameBtn.title = "重命名";
  renameBtn.innerHTML = `<i class="ph ph-pencil-simple"></i>`;
  renameBtn.onclick = (e) => {
    e.stopPropagation();
    opts.onRename(row);
  };

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "switch-row-action switch-row-delete";
  deleteBtn.title = "删除";
  deleteBtn.innerHTML = `<i class="ph ph-trash"></i>`;
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    opts.onDelete();
  };

  const actions = document.createElement("div");
  actions.className = "switch-row-actions";
  actions.appendChild(renameBtn);
  actions.appendChild(deleteBtn);

  row.appendChild(label);
  row.appendChild(actions);
  return row;
}

/** 把一行换成内联输入框做重命名；Enter 提交，Escape / 失焦取消。 */
function promptRename(host: HTMLElement, currentName: string, commit: (name: string) => Promise<void>) {
  const input = document.createElement("input");
  input.className = "switch-new-input";
  input.value = currentName;
  host.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener("click", (e) => e.stopPropagation());

  let submitting = false;
  async function confirm() {
    if (submitting) return;
    const name = input.value.trim();
    if (!name || name === currentName) {
      closeMenu();
      return;
    }
    submitting = true;
    try {
      await commit(name);
    } catch (err) {
      console.error("rename failed", err);
    }
    closeMenu();
  }

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void confirm();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    }
  });
  // 失焦即取消（下拉菜单点外部会先触发 closeMenu，这里只兜底）。
  input.addEventListener("blur", () => {
    if (!submitting) closeMenu();
  });
}

async function deleteProjectFlow(project: ProjectEntry) {
  if (!(await confirmDialog(`删除项目「${project.name}」？其下所有文件都会移到废纸篓。`))) return;
  try {
    await deleteProject(project.path);
  } catch (err) {
    console.error("delete project failed", err);
    return;
  }
  recent = recent.filter((p) => p !== project.path);
  await setRecentProjects(recent);
  const wasActive = mode === "project" && currentProject?.path === project.path;
  closeMenu();
  if (wasActive) {
    const remaining = await resolveProjects(recent);
    if (remaining[0]) {
      await openProject(remaining[0]);
    } else {
      const anchor = document.querySelector<HTMLElement>("#project-name");
      if (anchor) void showProjectSwitcher(anchor);
    }
  }
}

async function deleteDocumentFlow(doc: NoteEntry) {
  if (!(await confirmDialog(`删除文档「${doc.name}」？它会被移到废纸篓。`))) return;
  try {
    await deleteNote(parentDir(doc.path), doc.name);
  } catch (err) {
    console.error("delete document failed", err);
    return;
  }
  recentDocs = recentDocs.filter((p) => p !== doc.path);
  await setRecentDocuments(recentDocs);
  const wasActive = mode === "document" && currentDocument?.path === doc.path;
  closeMenu();
  if (wasActive) {
    if (currentProject) {
      try {
        await openProject(currentProject);
        return;
      } catch (err) {
        console.error("return to project failed", err);
      }
    }
    const anchor = document.querySelector<HTMLElement>("#project-name");
    if (anchor) void showProjectSwitcher(anchor);
  }
}

/** 新建文档：弹系统保存对话框，写空文件后打开。 */
function addNewDocumentEntry() {
  if (!menuEl) return;
  const item = document.createElement("button");
  item.className = "switch-item switch-new";
  item.innerHTML = `<i class="ph ph-file-plus"></i> 新建文档`;
  item.onclick = async (e) => {
    e.stopPropagation();
    closeMenu();
    const doc = await createDocument();
    if (!doc) return;
    await rememberDocument(doc.path);
    await openDocument(doc);
  };
  menuEl.appendChild(item);
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
    // "选择位置"可能弹了原生对话框使菜单已被外部点击关闭，重建一个最小输入态。
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

  // 检查 sidecar 启动状态：若有错误，在助手面板显示提示。
  const agentStatus = await invoke<{ ready: boolean; error: string | null }>("get_agent_status");
  if (agentStatus.error) {
    assistantHandle.showError(agentStatus.error);
  }
}

void init();

type QuotePayload = { text: string; html: string | null; source: Source | null };

void listen<QuotePayload>("quote-captured", (event) => {
  const { text, html, source } = event.payload;
  // 采集的选区可能带 `text/html`（浏览器、富文本编辑器）；有就转成 Markdown，
  // 让列表/表格/加粗在 quote 块里保留格式。转换为空（或纯文本源）时退回 text。
  const body = (html && htmlToMarkdown(html)) || text;
  const doc = editor.state.doc.toString();
  const caret = editor.state.selection.main.from;
  const target = resolveMergeTarget(doc, caret);
  if (target.kind === "merge") {
    const existing = doc.slice(target.range.from, target.range.to);
    const merged = mergeQuoteBlock(existing, body, source);
    editor.dispatch({
      changes: { from: target.range.from, to: target.range.to, insert: merged },
      selection: { anchor: target.range.from + merged.length },
      scrollIntoView: true,
    });
  } else {
    const before = doc.slice(0, caret);
    const after = doc.slice(caret);
    const insert = buildCaretInsert(before, after, buildQuoteBlock(body, source));
    insertAtCaret(editor, insert);
  }
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
