import "@phosphor-icons/web/regular";
import "../assistant/styles.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { mountAssistant, type AssistantHandle } from "../assistant/assistant";
import { agentNewSession, agentOpenSession, agentSend, agentCancel, agentListSkills, onAgentEvent, onFileChanged, onNoteUpdated } from "./agent";
import { buildCaretInsert } from "./append";
import { buildQuoteBlock, mergeQuoteBlock, resolveMergeTarget, type Source } from "./quote";
import { htmlToMarkdown } from "./paste";
import { EditorView, placeholder } from "@codemirror/view";
import { createEditor, insertAtPos, requestEditorLayout, setDoc } from "./editor";
import { blockHandleGutter, deleteBlock } from "./blocks/handle-gutter";
import { cancelBlockDrag, scrollerPositionTheme } from "./blocks/drag";
import { mountTagBar } from "./tags/bar";
import { showToast } from "../shared/toast";
import { tagDecorations } from "./tags/decoration";
import { tagFilter, setTagFilter } from "./tags/filter";
import { openBlockTagMenu } from "./tags/picker";
import { createLayoutController } from "./layout-controller";
import { createPieceHeader } from "./piece-switcher";
import { OutlineToggleEffect, outlineMode } from "./outline-mode";
import { actionTargetForTransition, createTasksPanel } from "./tasks-panel";
import {
  createDocument,
  createNote,
  createProject,
  confirmDialog,
  deleteNote,
  deleteProject,
  discardPending,
  flushAll,
  getConfig,
  inboxEntry,
  isDirty,
  listNotes,
  listPieces,
  listProjects,
  loadNote,
  onConflict,
  openDocumentFromFile,
  openExistingProject,
  renameNote,
  renameProject,
  resolveDocuments,
  resolveProjects,
  saveImmediate,
  scheduleSave,
  setRecentDocuments,
  setRecentProjects,
  tasksPath,
  type CurrentNote,
  type NoteEntry,
  type ProjectEntry,
} from "./notes-state";
import { parentDir, pushRecent, removeFromRecent } from "./recent-projects";
import { initScrollbar } from "./scrollbar";
import { renderEmptyState } from "./empty-state";
import {
  resolveBootstrap,
  resolveOpenProject,
  type WindowState,
} from "./window-state";
import {
  renderTitlebar,
  renderTopbar,
  setProjectLabel,
  setTasksToggle,
  setViewSeg,
} from "./topbar";
import { canSplit } from "./split";
import { buildBindings, installShortcuts, type ShortcutActions } from "./shortcuts";
import { WINDOW_SHORTCUT_DEFAULTS, type WindowShortcutId } from "../shared/shortcuts";
import { listVersions, restoreVersion, snapshotNote } from "./versions";
import {
  chatCreate,
  chatGetForScope,
  chatListForScope,
  chatOpen,
  chatUpdateTitle,
  sessionDirFromFile,
  type ChatConversation,
  type ChatScope,
} from "./chat-history";

const app = document.querySelector<HTMLElement>("#app")!;
app.innerHTML = `
  <div id="titlebar-root"></div>
  <div id="topbar-root"></div>
  <div id="note-body">
    <div id="tag-bar-root"></div>
    <div id="piece-topbar-root"></div>
    <div id="left-col"></div>
    <div id="text-col">
      <div id="editor-root"></div>
    </div>
    <div id="piece-col">
      <div id="piece-scroll">
        <div id="piece-doc-header"></div>
        <div id="piece-editor-root"></div>
      </div>
      <div id="piece-empty-root"></div>
    </div>
    <div id="assistant-region"></div>
  </div>
  <div id="body-empty-root"></div>
`;

const noteBody = document.querySelector<HTMLElement>("#note-body")!;
const assistantRegion = document.querySelector<HTMLElement>("#assistant-region")!;
const bodyEmptyRoot = document.querySelector<HTMLElement>("#body-empty-root")!;
const pieceEmptyRoot = document.querySelector<HTMLElement>("#piece-empty-root")!;

const DEFAULT_PROJECT_NAME = "未命名项目";
const DEFAULT_PIECE_TITLE = "未命名作品";
const DEFAULT_DOCUMENT_TITLE = "未命名文档";

/** 当前工作目录（隐式）：bootstrap 时从 config.working_dir 读取；项目新建时由后端
 * 自动回写，前端在此镜像。无工作目录时为空串——NO_PROJECT 空态的"新建项目"会弹
 * 目录选择让用户定位，"新建文档"则走保存对话框。用户不感知此概念。 */
let currentStartDir = "";

/** 空态渲染的清理句柄；切换状态前先清掉上一个，避免残留 DOM 与监听。 */
let cleanupBodyEmpty: (() => void) | null = null;
let cleanupPieceEmpty: (() => void) | null = null;

/** 清掉所有空态层，恢复到编辑器可见。LOADED 与文档模式都走这里。 */
function clearEmptyState() {
  app.classList.remove("state-no-project", "state-path-error", "state-no-piece");
  cleanupBodyEmpty?.();
  cleanupBodyEmpty = null;
  cleanupPieceEmpty?.();
  cleanupPieceEmpty = null;
}

/** 按窗口状态渲染对应空态。LOADED 不渲染空态，只清理。文档模式由 openDocument
 * 自行调 clearEmptyState。 */
function renderWindowState(state: WindowState) {
  clearEmptyState();
  switch (state.kind) {
    case "NO_PROJECT":
      assistantHandle?.setScope(null);
      app.classList.add("state-no-project");
      setProjectLabel("");
      cleanupBodyEmpty = renderEmptyState(bodyEmptyRoot, {
        icon: "✍️",
        title: "欢迎来到 FloatNote",
        hint: "还没有项目空间。新建一个项目开始写作，打开已有文件夹，或直接新建一篇独立文档。",
        primary: { label: "新建项目", action: () => void createDefaultProject() },
        secondary: { label: "新建文档", action: () => void createStandaloneDocument() },
        tertiary: { label: "打开现有项目", action: () => void openExistingProjectFlow() },
      });
      break;
    case "PATH_ERROR":
      assistantHandle?.setScope(null);
      app.classList.add("state-path-error");
      setProjectLabel("");
      cleanupBodyEmpty = renderEmptyState(bodyEmptyRoot, {
        icon: "⚠️",
        title: "读取失败",
        hint: state.error ?? "无法读取项目列表，请稍后重试。",
        primary: { label: "重试", action: () => void retryBootstrap() },
      });
      break;
    case "NO_PIECE":
      app.classList.add("state-no-piece");
      // 空态下无当前作品：清掉残留引用与面包屑/标题，避免上一个项目的作品名泄漏到新空态。
      currentPiece = null;
      pieceHeader?.setLabel("");
      surface = "piece";
      cleanupPieceEmpty = renderEmptyState(pieceEmptyRoot, {
        icon: "📝",
        title: "这里还没有作品",
        hint: `在「${state.project.name}」里新建一篇开始写作。`,
        primary: { label: "新建作品", action: () => void createFirstPiece() },
      });
      break;
    case "LOADED":
      break;
  }
}

/** 最近打开的项目路径（MRU，最近在前，上限 8）。项目可散落在磁盘任意位置，
 * 此列表是项目切换菜单的唯一数据来源，并持久化到 config.recent_projects。 */
let recent: string[] = [];
/** 最近打开的独立文档路径（MRU，与 recent 平行）。持久化到 config.recent_documents。 */
let recentDocs: string[] = [];
let currentProject: ProjectEntry | null = null;
let current: CurrentNote | null = null;
/** 当前窗口模式：项目（含采集/写作/双栏）或独立文档（单一编辑器，无滑拨杆）。 */
let mode: "project" | "document" = "project";
/** 进入文档模式前行动面板是否开着 —— 独立文档无 _tasks.md，进文档时关掉行动，
 *  返回项目时按此值恢复，呈现「临时遮挡」语义。仅项目→文档那一刻写入。 */
let actionDesiredOpen = false;
/** 文档模式下打开的独立文档；项目模式下为 null。复用 pieceEditor 渲染。 */
let currentDocument: NoteEntry | null = null;
let menuEl: HTMLElement | null = null;
/** The project-name button the switcher menu is anchored to (for repositioning). */
let menuAnchor: HTMLElement | null = null;
/** 当前打开的二级菜单浮层（项目/文档标题的 `+` 展开），与主菜单同生命周期。 */
let submenuEl: HTMLElement | null = null;
/** 二级菜单的触发按钮，用于切换 aria-expanded。 */
let submenuTrigger: HTMLElement | null = null;
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
  { noteDirProvider: () => currentProject?.path ?? currentStartDir },
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
let pieceOutlineDefault = false;
let pieceOutlineSessionOverride: boolean | null = null;
let pieceOutlineOn = false;

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
  [scrollerPositionTheme, ...outlineMode(), placeholder("开始写……")],
  {
    grow: true,
    // pieceEditor is shared by project piece mode AND document mode. Branch on
    // mode so document images land next to the document file, not the project dir.
    noteDirProvider: () =>
      mode === "document" && currentDocument
        ? parentDir(currentDocument.path)
        : (currentProject?.path ?? currentStartDir),
  },
);
// 滑块挂在不滚动的 #piece-col 上，监听真正滚动的 #piece-scroll。
requestAnimationFrame(() => initScrollbar(pieceCol, pieceScroll));

// 焦点跟随：哪个 surface 获得焦点，助手 active_note 就指向它（成品=润色面）。
pieceEditor.contentDOM.addEventListener("focus", () => {
  const f = activePieceFile();
  if (!f) return;
  const dir = mode === "document" ? parentDir(f.path) : currentProject?.path;
  if (!dir) return;
  void invoke("set_active_note", {
    dir,
    noteId: f.name,
    path: f.path,
    kind: mode === "document" ? "doc" : "piece",
  });
});

// 文档头（标题 + 切换箭头）挂在「写作」栏内容区顶部，随正文一起滚。
let pieceHeader: ReturnType<typeof createPieceHeader> | null = null;

function applyPieceOutlineMode(next: boolean, opts: { user?: boolean } = {}) {
  if (opts.user) pieceOutlineSessionOverride = next;
  const lineNumber = pieceEditor.state.doc.lineAt(pieceEditor.state.selection.main.from).number;
  pieceOutlineOn = next;
  pieceEditor.dispatch({ effects: OutlineToggleEffect.of(next) });
  const line = pieceEditor.state.doc.line(Math.min(lineNumber, pieceEditor.state.doc.lines));
  pieceEditor.dispatch({
    selection: { anchor: line.from },
    scrollIntoView: true,
  });
  pieceHeader?.setOutlineMode(next);
  requestEditorLayout(pieceEditor);
}

function resetPieceOutlineForOpen() {
  applyPieceOutlineMode(pieceOutlineSessionOverride ?? pieceOutlineDefault);
}

function mountPieceHeader() {
  const topbar = document.querySelector<HTMLElement>("#piece-topbar-root")!;
  const titleHost = document.querySelector<HTMLElement>("#piece-doc-header")!;
  pieceHeader = createPieceHeader({ topbarMount: topbar, titleMount: titleHost, host: {
    dir: () =>
      mode === "document"
        ? currentDocument
          ? parentDir(currentDocument.path)
          : ""
        : currentProject?.path ?? "",
    current: () => activePieceFile(),
    open: async (entry) => {
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
        await openPiece(entry);
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
      applyRemoteTo(pieceEditor, restored);
    },
    onEmptied: () => {
      // 当前 piece 被删且项目已无 piece：清掉引用，切到 NO_PIECE 空态。
      currentPiece = null;
      if (currentProject) {
        renderWindowState({ kind: "NO_PIECE", project: currentProject });
      }
      surface = "piece";
      applyView();
    },
    focusTitle: () => focusPieceTitle(),
    focusBody: () => {
      // 标题回车后，焦点落到正文编辑器首行行首。
      pieceEditor.focus();
      pieceEditor.dispatch({ selection: { anchor: 0, head: 0 } });
    },
    isOutlineMode: () => pieceOutlineOn,
    setOutlineMode: (next) => applyPieceOutlineMode(next, { user: true }),
  },
  });
  pieceHeader.setOutlineMode(pieceOutlineOn);
}

async function openPiece(entry: NoteEntry) {
  currentPiece = entry;
  pieceHeader?.setLabel(entry.name);
  applyRemoteTo(pieceEditor, await loadNote(entry.path));
  resetPieceOutlineForOpen();
}

/** 打开一个独立文档：切到文档模式，复用 pieceEditor 渲染该文件。 */
async function openDocument(doc: NoteEntry) {
  // 独立文档无 _tasks.md：进入文档模式时把行动「临时遮挡」——记下开关并关掉，
  // 返回项目时按记忆恢复（见 openProject）。
  const plan = actionTargetForTransition({
    from: mode,
    to: "document",
    currentOpen: tasksPanel.isOpen(),
    rememberedOpen: actionDesiredOpen,
  });
  if (plan.remember !== null) actionDesiredOpen = plan.remember;
  tasksPanel.setOpen(plan.open);
  mode = "document";
  currentDocument = doc;
  recentDocs = pushRecent(recentDocs, doc.path);
  await setRecentDocuments(recentDocs);
  setProjectLabel(doc.name);
  clearEmptyState();
  applyRemoteTo(pieceEditor, await loadNote(doc.path));
  resetPieceOutlineForOpen();
  pieceHeader?.setLabel(doc.name);
  applyView();
  void invoke("set_active_note", { dir: parentDir(doc.path), noteId: doc.name, path: doc.path, kind: "doc" });
  assistantHandle.setScope(currentChatScope());
  // 独立文档不在项目目录内，停掉文件监听以免误刷新（返回项目时再 watch_dir）。
  void invoke("unwatch_dir");
}

/** 列举项目内的 piece；失败时返回空数组并把错误上抛由调用方决定回退。 */
async function loadFirstPiece(): Promise<NoteEntry[]> {
  const dir = currentProject!.path;
  return listPieces(dir);
}

function publishInboxActive() {
  if (!currentProject || !current) return;
  void invoke("set_active_note", {
    dir: currentProject.path,
    noteId: current.entry.name,
    path: current.entry.path,
    kind: "inbox",
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

function selectView(view: "inbox" | "piece" | "split") {
  if (view === "split") {
    layoutController?.setSplit(true);
  } else {
    surface = view;
    layoutController?.setSplit(false);
  }
  applyView();
  tasksPanel.syncLayout();
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
function applyRemoteTo(view: EditorView, content: string) {
  applyingRemote = true;
  try {
    setDoc(view, content);
  } finally {
    applyingRemote = false;
  }
}

function applyRemoteDoc(content: string) {
  applyRemoteTo(editor, content);
}

const assistantHandle: AssistantHandle = mountAssistant(assistantRegion, {
  send: (text, conversationId) => {
    return agentSend({ conversationId, userText: text });
  },
  createConversation: async (scope) => {
    const conversation = await chatCreate(scope);
    await agentNewSession({
      conversationId: conversation.id,
      cwd: scope.cwd,
      sessionDir: sessionDirFromFile(conversation.sessionFile),
    });
    return conversation;
  },
  openConversation: async (conversation) => {
    const opened = await chatOpen(conversation.id);
    if (!opened) return null;
    await agentOpenSession({
      conversationId: opened.id,
      sessionFile: opened.sessionFile,
    });
    return opened;
  },
  listConversations: (scope) => chatListForScope(scope),
  getLastConversation: (scope) => chatGetForScope(scope),
  updateTitle: (conversationId, title, titleState) => chatUpdateTitle(conversationId, title, titleState),
  subscribe: (cb) => onAgentEvent(cb),
  cancel: (requestId) => { void agentCancel(requestId); },
  listSkills: () => agentListSkills(),
  listFiles: async (scope) => {
    if (scope.scopeType === "project") {
      // 项目模式：列出项目内全部 .md（采集区 _inbox、任务 _tasks、各 piece）
      const notes = await listNotes(scope.scopePath);
      return notes.map((n) => ({
        name: n.name,
        kind: n.name === "_inbox" ? "inbox" : n.name === "_tasks" ? "tasks" : "piece",
      }));
    }
    // 文档模式：仅当前文档
    return [{ name: currentDocument?.name ?? scope.scopeLabel, kind: "doc" as const }];
  },
});

async function toggleAssistantFromChrome() {
  const next = await invoke<{ open: boolean }>("toggle_assistant");
  layoutController?.setAssistantOpen(next.open);
  tasksPanel.syncLayout();
  assistantHandle.setInputOpen(next.open);
}

void listen<ChatConversation>("chat://open", (event) => {
  void openConversationFromHistory(event.payload);
});

void listen<string>("chat://open-id", async (event) => {
  const conversation = await chatOpen(event.payload);
  if (conversation) {
    await openConversationFromHistory(conversation);
  }
});

async function openConversationFromHistory(conversation: ChatConversation) {
  const win = getCurrentWindow();
  await win.show();
  await win.setFocus();
  if (conversation.scopeType === "project") {
    const [project] = await resolveProjects([conversation.scopePath]);
    if (!project) {
      assistantHandle.showError("这个项目已不可用，可在对话历史中删除该记录。");
      return;
    }
    await openProject(project);
  } else {
    const [document] = await resolveDocuments([conversation.scopePath]);
    if (!document) {
      assistantHandle.showError("这个文档已不可用，可在对话历史中删除该记录。");
      return;
    }
    await openDocument(document);
  }
  await assistantHandle.openConversation(conversation);
}

function currentChatScope(): ChatScope | null {
  if (mode === "document") {
    if (!currentDocument) return null;
    return {
      scopeType: "document",
      scopePath: currentDocument.path,
      scopeLabel: currentDocument.name,
      cwd: parentDir(currentDocument.path),
    };
  }
  if (!currentProject) return null;
  return {
    scopeType: "project",
    scopePath: currentProject.path,
    scopeLabel: currentProject.name,
    cwd: currentProject.path,
  };
}

void onNoteUpdated(async (payload) => {
  // 与 onFileChanged 对齐：编辑器有未保存的本地修改时跳过 AI 热刷新，
  // 否则磁盘内容会覆盖用户输入，而 pending 仍持旧内容会在后续 flush 时盖回 AI 结果。
  if (isDirty(payload.path)) return;
  // 采集面（项目模式）被 AI 改写。
  if (current && payload.path === current.entry.path) {
    applyRemoteDoc(await loadNote(current.entry.path));
    return;
  }
  // 成品 / 独立文档被 AI 改写（文档模式无文件监听，靠这条热刷新）。
  const f = activePieceFile();
  if (f && payload.path === f.path) {
    applyRemoteTo(pieceEditor, await loadNote(f.path));
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
    try {
      applyRemoteDoc(await loadNote(current.entry.path));
    } catch {
      // _inbox.md 被外部删除 → 该目录不再是项目空间，回到 bootstrap 重新定位。
      console.warn("inbox vanished, re-bootstrapping");
      current = null;
      currentProject = null;
      await bootstrapProjects(await getConfig());
    }
    return;
  }
  // 成品（piece）或独立文档被外部修改 / 删除。
  if (activeFile && changedPath === activeFile.path) {
    try {
      applyRemoteTo(pieceEditor, await loadNote(activeFile.path));
    } catch {
      // 文件已不存在（外部删除）→ 列剩余 pieces，切下一片或 NO_PIECE。
      await handleActivePieceGone();
    }
    return;
  }
  // 行动（_tasks.md）被外部修改。
  if (currentProject && changedPath === tasksPath(currentProject.path)) {
    tasksPanel.reload();
    return;
  }
});

// 保存冲突：磁盘被外部改动而本地有未保存编辑时，由 write_note 的 mtime 守卫触发。
onConflict(async (path, localContent) => {
  const keepMine = await confirmDialog(
    `文件已在外部被修改：\n${path}\n\n「确定」保留我的编辑并覆盖磁盘；「取消」用磁盘版本替换本地。`,
    "保存冲突",
  );
  if (keepMine) {
    await saveImmediate(path, localContent, { force: true });
    return;
  }
  // 保留磁盘版本：先丢弃本地 pending（清掉 dirty，避免后续重载被跳过），再按路径把
  // 磁盘内容重新注入对应编辑器。路由必须与 onFileChanged 一致——否则 tasks 文件或
  // 已切换项目的旧路径会被错误地塞进 pieceEditor 而覆盖 piece 内容。
  discardPending(path);
  const activeFile = activePieceFile();
  if (current && path === current.entry.path) {
    applyRemoteDoc(await loadNote(path));
  } else if (activeFile && path === activeFile.path) {
    applyRemoteTo(pieceEditor, await loadNote(path));
  } else if (currentProject && path === tasksPath(currentProject.path)) {
    tasksPanel.reload();
  } else {
    // 路径已失效（如项目已切换）—— 仅刷新 lastKnown，无对应编辑器需要更新。
    await loadNote(path);
  }
});

// 关闭/隐藏前尽量把 pending 写盘（窗口关闭被后端改为隐藏，webview 存活，invoke 可完成）。
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushAll();
});
window.addEventListener("pagehide", () => flushAll());

/** 当前装载的 piece / 文档被外部删除后的兜底：项目模式 → 切下一片或 NO_PIECE；
 * 文档模式 → 回到项目或弹切换菜单。不再兜底建时间戳文件。 */
async function handleActivePieceGone() {
  if (mode === "document") {
    const gone = currentDocument;
    currentDocument = null;
    if (gone) {
      recentDocs = recentDocs.filter((p) => p !== gone.path);
      await setRecentDocuments(recentDocs);
    }
    if (currentProject) {
      try {
        await openProject(currentProject);
        return;
      } catch (err) {
        console.error("return to project failed", err);
      }
    }
    await bootstrapProjects(await getConfig());
    return;
  }
  if (!currentProject) return;
  const remaining = await listPieces(currentProject.path).catch(() => []);
  if (remaining[0]) {
    currentPiece = remaining[0];
    await openPiece(remaining[0]);
    renderWindowState({ kind: "LOADED", project: currentProject, piece: remaining[0] });
  } else {
    currentPiece = null;
    renderWindowState({ kind: "NO_PIECE", project: currentProject });
  }
  surface = "piece";
  applyView();
}

function closeMenu() {
  closeSubmenu();
  menuEl?.remove();
  menuEl = null;
}

/** 收起二级菜单，同步把触发按钮的 aria-expanded 复位。 */
function closeSubmenu() {
  if (submenuEl) {
    submenuEl.remove();
    submenuEl = null;
  }
  if (submenuTrigger) {
    submenuTrigger.setAttribute("aria-expanded", "false");
    submenuTrigger = null;
  }
}

/** 在 `trigger` 右侧（空间不足则下方）弹出一个二级菜单，`items` 为其条目。
 * 条目点击后由调用方自行决定是否关闭主菜单。点击子菜单内部不冒泡到主菜单
 * 的「外部点击关闭」监听；Esc 先收起子菜单。 */
function openSubmenu(trigger: HTMLElement, items: HTMLElement[]) {
  closeSubmenu();
  submenuTrigger = trigger;
  trigger.setAttribute("aria-expanded", "true");

  const sub = document.createElement("div");
  sub.className = "switch-submenu";
  for (const item of items) sub.appendChild(item);

  // 先挂载以测尺寸，再按锚点 + 视口定位。
  sub.style.visibility = "hidden";
  document.body.appendChild(sub);
  const r = trigger.getBoundingClientRect();
  const w = sub.offsetWidth;
  const h = sub.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = r.right + w > vw ? Math.max(8, r.left - w) : r.right;
  const top = r.bottom + h > vh ? Math.max(8, r.top - h) : r.bottom;
  sub.style.left = `${left}px`;
  sub.style.top = `${top}px`;
  sub.style.visibility = "";

  // 子菜单内点击不触发主菜单的外部关闭。
  sub.addEventListener("click", (e) => e.stopPropagation());
  // Esc：先收起子菜单；不阻止后续事件，主菜单自身不收（保持打开）。
  sub.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeSubmenu();
      trigger.focus();
    }
  });

  submenuEl = sub;

  // 焦点进子菜单首项，便于键盘操作（Esc 收起、Tab 遍历）。
  const first = items.find((it) => !(it as HTMLButtonElement).disabled) as HTMLButtonElement | undefined;
  first?.focus();
}

/** 构造一个二级菜单条目按钮。`disabled` 时置灰且不响应点击。 */
function makeSubmenuItem(label: string, opts: { onClick?: () => void; disabled?: boolean; ariaLabel?: string } = {}): HTMLElement {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "switch-submenu-item";
  item.innerHTML = label;
  if (opts.ariaLabel) item.setAttribute("aria-label", opts.ariaLabel);
  if (opts.disabled) {
    item.disabled = true;
    item.classList.add("disabled");
  } else if (opts.onClick) {
    item.onclick = (e) => {
      e.stopPropagation();
      opts.onClick!();
    };
  }
  return item;
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
  // 从文档模式返回项目：按离开项目时记下的开关恢复行动面板。
  const wasDocument = mode === "document";
  mode = "project";
  currentDocument = null;
  currentProject = project;
  await rememberProject(project.path);
  const entry = inboxEntry(project);
  current = { dir: project.path, entry };
  setProjectLabel(project.name);
  applyRemoteDoc(await loadNote(entry.path));
  // 加载第一篇 piece — 不再兜底建时间戳文件；空列表 → NO_PIECE 空态。
  let pieces: NoteEntry[];
  try {
    pieces = await loadFirstPiece();
  } catch (err) {
    // 项目目录在打开过程中消失（被外部删除/权限丢失）→ 回到 bootstrap 兜底。
    console.error("list pieces failed", err);
    currentProject = null;
    current = null;
    await bootstrapProjects(await getConfig());
    return;
  }
  const state = resolveOpenProject({ project, pieces });
  if (state.kind === "LOADED") {
    await openPiece(state.piece);
  }
  renderWindowState(state);
  tasksPanel.reload();
  // 文档→项目恢复行动面板：reload 已加载新项目 tasks，setOpen 仅切可见态。
  // 同模式（项目→项目）时 plan.open === 当前开关，setOpen 的 no-op 守卫不触发副作用。
  const plan = actionTargetForTransition({
    from: wasDocument ? "document" : "project",
    to: "project",
    currentOpen: tasksPanel.isOpen(),
    rememberedOpen: actionDesiredOpen,
  });
  tasksPanel.setOpen(plan.open);
  applyView();
  // 发布活动笔记（= 当前项目的 _inbox.md），供独立助手窗 / apply_write 定位。
  void invoke("set_active_note", { dir: project.path, noteId: entry.name, path: entry.path, kind: "inbox" });
  assistantHandle.setScope(currentChatScope());
  // 切换文件监听到新项目目录。
  void invoke("watch_dir", { dir: project.path });
}

/** 启动时打开项目：优先 MRU 列表里仍存在的第一个；MRU 为空时扫描工作目录下的
 * 项目空间。工作目录缺失或不可读则静默降级为 NO_PROJECT（不报错给用户）。MRU 解析
 * 本身抛错才进 PATH_ERROR。两者都空时进入 NO_PROJECT 欢迎空态（不强制 scaffold）。 */
async function bootstrapProjects(config: Awaited<ReturnType<typeof getConfig>>) {
  recent = config.recent_projects ?? [];
  recentDocs = config.recent_documents ?? [];
  const startDir = config.working_dir ?? "";
  currentStartDir = startDir;

  let recentResolved: ProjectEntry[] = [];
  let projects: ProjectEntry[] = [];
  try {
    recentResolved = await resolveProjects(recent);
  } catch (err) {
    renderWindowState({ kind: "PATH_ERROR", startDir, error: String(err) });
    return;
  }
  recent = recentResolved.map((p) => p.path);

  // MRU 为空时尝试扫描工作目录；工作目录找不到/不可读 → 视为没有工作目录，静默降级。
  if (recentResolved.length === 0 && startDir) {
    try {
      projects = await listProjects(startDir);
    } catch {
      // 工作目录不可读：降级到 NO_PROJECT，不向用户暴露"工作目录"概念。
    }
  }

  const outcome = resolveBootstrap({ recent: recentResolved, projects, startDir });
  if (outcome.kind === "OPEN") {
    await openProject(outcome.project);
    return;
  }
  // NO_PROJECT / PATH_ERROR：terminal 空态，不再自动建项目。
  renderWindowState(outcome);
}

/** NO_PROJECT 空态"新建项目"：有工作目录则在目录下直接建默认名项目；无工作目录时
 * 弹目录选择让用户定位。后端 create_project 会把所选目录记为工作目录，前端镜像到
 * currentStartDir。不预建 piece、不弹输入框——之后可在切换菜单里重命名。 */
async function createDefaultProject() {
  let parent = currentStartDir;
  if (!parent) {
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    parent = picked;
  }
  const project = await createProject(parent, DEFAULT_PROJECT_NAME);
  currentStartDir = parent;
  await openProject(project);
}

/** NO_PROJECT 空态"新建文档"：有工作目录则在目录下直接建；无工作目录时走保存对话框
 * 让用户选位置（文档不更新工作目录）。载入并聚焦标题栏全选，键入即替换标题。 */
async function createStandaloneDocument() {
  const entry = currentStartDir
    ? await createNote(currentStartDir, DEFAULT_DOCUMENT_TITLE)
    : await createDocument();
  if (!entry) return;
  await rememberDocument(entry.path);
  await openDocument(entry);
  focusPieceTitle();
}

/** NO_PIECE 空态"新建作品"：默认名建 piece，载入并聚焦标题栏全选。 */
async function createFirstPiece() {
  if (!currentProject) return;
  const entry = await createNote(currentProject.path, DEFAULT_PIECE_TITLE);
  await openPiece(entry);
  renderWindowState({ kind: "LOADED", project: currentProject, piece: entry });
  surface = "piece";
  applyView();
  focusPieceTitle();
}

/** 聚焦并全选 piece 标题栏（用于新建后原地改名）。延迟一帧等布局就位。 */
function focusPieceTitle() {
  requestAnimationFrame(() => pieceHeader?.focusTitle());
}

/** PATH_ERROR"重试"：重新跑一次 bootstrap。 */
async function retryBootstrap() {
  await bootstrapProjects(await getConfig());
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
  menuEl.appendChild(
    sectionHeader("ph-folder", "项目", {
      ariaLabel: "新建项目",
      onOpen: (trigger) => openProjectAddSubmenu(trigger),
    }),
  );
  if (projects.length > 0) {
    for (const project of projects) {
      menuEl.appendChild(
        makeSwitcherRow({
          label: project.name,
          active: mode === "project" && currentProject?.path === project.path,
          onOpen: () => {
            closeMenu();
            void openProject(project);
          },
          actions: [
            {
              label: "重命名",
              icon: "ph-pencil-simple",
              onClick: (host) =>
                void promptRename(host, project.name, async (name) => {
                  const newPath = await renameProject(project.path, name);
                  recent = recent.map((p) => (p === project.path ? newPath : p));
                  await setRecentProjects(recent);
                  if (mode === "project" && currentProject?.path === project.path) {
                    currentProject = { name, path: newPath };
                    setProjectLabel(name);
                  }
                }),
            },
            {
              label: "从最近列表移除",
              icon: "ph-minus-circle",
              onClick: () => void removeProjectFromRecent(project),
            },
            {
              label: "删除（移到废纸篓）",
              icon: "ph-trash",
              danger: true,
              onClick: () => void deleteProjectFlow(project),
            },
          ],
        }),
      );
    }
  } else {
    menuEl.appendChild(emptySectionHint("暂无项目"));
  }

  // ── 文档区 ──
  menuEl.appendChild(
    sectionHeader("ph-file", "文档", {
      ariaLabel: "新建或打开文档",
      onOpen: (trigger) => openDocumentAddSubmenu(trigger),
    }),
  );
  if (documents.length > 0) {
    for (const doc of documents) {
      menuEl.appendChild(
        makeSwitcherRow({
          label: doc.name,
          active: mode === "document" && currentDocument?.path === doc.path,
          onOpen: () => {
            closeMenu();
            void openDocument(doc);
          },
          actions: [
            {
              label: "重命名",
              icon: "ph-pencil-simple",
              onClick: (host) =>
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
            },
            {
              label: "从最近列表移除",
              icon: "ph-minus-circle",
              onClick: () => void removeDocumentFromRecent(doc),
            },
            {
              label: "删除（移到废纸篓）",
              icon: "ph-trash",
              danger: true,
              onClick: () => void deleteDocumentFlow(doc),
            },
          ],
        }),
      );
    }
  } else {
    menuEl.appendChild(emptySectionHint("暂无文档"));
  }

  document.body.appendChild(menuEl);
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
}

/** 区块标题（项目 / 文档）：左侧 Phosphor 图标 + 文字，右侧一个 `+` 展开
 * 二级菜单（添加入口）。`add` 缺省时不渲染 `+`。 */
function sectionHeader(
  icon: string,
  label: string,
  add?: { ariaLabel: string; onOpen: (trigger: HTMLButtonElement) => void },
): HTMLElement {
  const h = document.createElement("div");
  h.className = "switch-section";
  h.innerHTML = `<i class="ph ${icon}"></i><span>${label}</span>`;
  if (add) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "switch-section-add";
    btn.setAttribute("aria-label", add.ariaLabel);
    btn.setAttribute("aria-haspopup", "menu");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = `<i class="ph ph-plus"></i>`;
    btn.onclick = (e) => {
      e.stopPropagation();
      // 再次点击同一个 `+` 收起子菜单。
      if (submenuTrigger === btn) {
        closeSubmenu();
        return;
      }
      add.onOpen(btn);
    };
    h.appendChild(btn);
  }
  return h;
}

/** 区块列表为空时的灰色提示行（不可点）。 */
function emptySectionHint(text: string): HTMLElement {
  const h = document.createElement("div");
  h.className = "switch-empty-hint";
  h.textContent = text;
  return h;
}

interface RowAction {
  label: string;
  /** Phosphor icon class without the `ph ` prefix, e.g. `ph-pencil-simple`. */
  icon: string;
  /** Danger actions render red (e.g. delete). */
  danger?: boolean;
  /** Receives the row element so rename can replace it in-place. */
  onClick: (row: HTMLElement) => void;
}

interface SwitcherRowOpts {
  label: string;
  active?: boolean;
  onOpen: () => void;
  actions: RowAction[];
}

/** Build the kebab submenu items for a row. Each item closes the submenu then
 * runs its action, passing the row element (rename replaces it in-place).
 * Reuses `makeSubmenuItem` so styling/keyboard behavior match the section `+`
 * submenus. */
function buildKebabItems(row: HTMLElement, actions: RowAction[]): HTMLElement[] {
  return actions.map((a) => {
    const item = makeSubmenuItem(`<i class="ph ${a.icon}"></i> ${a.label}`, {
      onClick: () => {
        closeSubmenu();
        a.onClick(row);
      },
    });
    if (a.danger) item.classList.add("danger");
    return item;
  });
}

/** Open the kebab submenu anchored to `trigger`. Reuses the section-header
 * submenu infra: a single live submenu at a time, click-away and Esc handled by
 * `openSubmenu`. */
function openRowKebab(trigger: HTMLElement, row: HTMLElement, actions: RowAction[]) {
  openSubmenu(trigger, buildKebabItems(row, actions));
}

/** 切换菜单的一行：左侧标签（点击打开），右侧悬停露出一个 `⋯` kebab 按钮，
 * 点击展开二级菜单承载行操作（重命名 / 移除 / 删除…）。
 * 行体是 div（而非 button），避免 button-in-button 嵌套。
 * 不再为每行渲染图标——区块标题的图标已代表类别，行内只留名称。 */
function makeSwitcherRow(opts: SwitcherRowOpts): HTMLElement {
  const row = document.createElement("div");
  row.className = "switch-row";
  if (opts.active) row.classList.add("active");

  const label = document.createElement("button");
  label.className = "switch-row-label";
  label.innerHTML = `<span class="switch-row-name">${opts.label}</span>`;
  label.onclick = (e) => {
    e.stopPropagation();
    opts.onOpen();
  };

  const kebab = document.createElement("button");
  kebab.type = "button";
  kebab.className = "switch-row-action switch-row-kebab";
  kebab.title = "更多";
  kebab.setAttribute("aria-label", "更多操作");
  kebab.setAttribute("aria-haspopup", "menu");
  kebab.setAttribute("aria-expanded", "false");
  kebab.innerHTML = `<i class="ph ph-dots-three-vertical"></i>`;
  kebab.onclick = (e) => {
    e.stopPropagation();
    // 再次点击同一个 kebab 收起子菜单。
    if (submenuTrigger === kebab) {
      closeSubmenu();
      return;
    }
    openRowKebab(kebab, row, opts.actions);
  };

  const actions = document.createElement("div");
  actions.className = "switch-row-actions";
  actions.appendChild(kebab);

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
    currentProject = null;
    current = null;
    currentPiece = null;
    await bootstrapProjects(await getConfig());
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
    currentDocument = null;
    if (currentProject) {
      try {
        await openProject(currentProject);
        return;
      } catch (err) {
        console.error("return to project failed", err);
      }
    }
    await bootstrapProjects(await getConfig());
  }
}

/** 从最近列表移除项目（不删磁盘文件、不弹确认）。与 deleteProjectFlow 同构地处理
 * "移除的是当前打开项"——清状态后回 bootstrap 重定位。被移除的文件夹仍在原地，
 * 下次「打开现有项目」选同一文件夹即可找回。 */
async function removeProjectFromRecent(project: ProjectEntry) {
  recent = removeFromRecent(recent, project.path);
  await setRecentProjects(recent);
  const wasActive = mode === "project" && currentProject?.path === project.path;
  closeMenu();
  if (wasActive) {
    currentProject = null;
    current = null;
    currentPiece = null;
    await bootstrapProjects(await getConfig());
  }
}

/** 从最近列表移除文档（不删磁盘文件、不弹确认）。镜像 removeProjectFromRecent。 */
async function removeDocumentFromRecent(doc: NoteEntry) {
  recentDocs = removeFromRecent(recentDocs, doc.path);
  await setRecentDocuments(recentDocs);
  const wasActive = mode === "document" && currentDocument?.path === doc.path;
  closeMenu();
  if (wasActive) {
    currentDocument = null;
    if (currentProject) {
      try {
        await openProject(currentProject);
        return;
      } catch (err) {
        console.error("return to project failed", err);
      }
    }
    await bootstrapProjects(await getConfig());
  }
}

/** 「打开现有项目」：选一个已有文件夹；后端无 `_inbox.md` 则自动建空 Inbox，
 * 再加入 MRU 并打开。working_dir 由后端落盘为该文件夹父目录，前端镜像到
 * currentStartDir 使后续「在当前目录新建」指向新父目录。 */
async function openExistingProjectFlow() {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;
  try {
    const project = await openExistingProject(picked);
    currentStartDir = parentDir(project.path);
    await rememberProject(project.path);
    await openProject(project);
  } catch (err) {
    console.error("open existing project failed", err);
    showToast("无法打开该文件夹：" + String(err));
  }
}

/** 在锚点（项目名按钮）下方重建一个空的最小浮层，用于承载命名输入框。
 * 用于「选择位置新建」等会弹原生对话框、可能令主菜单已被外点击关闭的场景。 */
function rebuildMenuAtAnchor(): HTMLElement | null {
  if (!menuAnchor) return null;
  const m = document.createElement("div");
  m.className = "switch-menu";
  const rect = menuAnchor.getBoundingClientRect();
  m.style.left = `${rect.left}px`;
  m.style.top = `${rect.bottom + 2}px`;
  document.body.appendChild(m);
  setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  return m;
}

/** 收起当前菜单，在锚点处开一个只含命名输入框的最小浮层。 */
function beginNewProjectName(parent: string) {
  closeMenu();
  const m = rebuildMenuAtAnchor();
  if (!m) return;
  menuEl = m;
  promptNewProjectName(m, parent);
}

/** 项目标题 `+` 的二级菜单：在当前目录新建 / 选择位置新建… */
function openProjectAddSubmenu(trigger: HTMLButtonElement) {
  const items = [
    makeSubmenuItem(`<i class="ph ph-plus"></i> 在当前目录新建`, {
      disabled: !currentProject,
      onClick: () => {
        if (!currentProject) return;
        beginNewProjectName(parentDir(currentProject.path));
      },
    }),
    makeSubmenuItem(`<i class="ph ph-folder-open"></i> 选择位置新建…`, {
      onClick: async () => {
        const picked = await open({ directory: true, multiple: false });
        const parent = typeof picked === "string" ? picked : null;
        if (!parent) {
          closeMenu();
          return;
        }
        beginNewProjectName(parent);
      },
    }),
    makeSubmenuItem(`<i class="ph ph-folder-open"></i> 打开现有项目…`, {
      onClick: async () => {
        closeSubmenu();
        closeMenu();
        await openExistingProjectFlow();
      },
    }),
  ];
  openSubmenu(trigger, items);
}

/** 文档标题 `+` 的二级菜单：新建文档 / 打开 Markdown 文件… */
function openDocumentAddSubmenu(trigger: HTMLButtonElement) {
  const items = [
    makeSubmenuItem(`<i class="ph ph-file-plus"></i> 新建文档…`, {
      onClick: async () => {
        closeSubmenu();
        closeMenu();
        const doc = await createDocument();
        if (!doc) return;
        await rememberDocument(doc.path);
        await openDocument(doc);
      },
    }),
    makeSubmenuItem(`<i class="ph ph-folder-open"></i> 打开 Markdown 文件…`, {
      onClick: async () => {
        closeSubmenu();
        closeMenu();
        const doc = await openDocumentFromFile();
        if (!doc) return;
        await rememberDocument(doc.path);
        await openDocument(doc);
      },
    }),
  ];
  openSubmenu(trigger, items);
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
    // 后端 create_project 已把 working_dir 落盘为 parent；同步内存镜像，使后续
    // 新建项目/文档默认落在同一目录（"在当前目录新建" 与 "选择位置新建" 共用此路径）。
    currentStartDir = parent;
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
    selectView(view);
  },
  onToggleTasks: () => tasksPanel.toggle(),
});

// #piece-doc-header 已在 app.innerHTML 中就位，挂载文档头到「写作」栏顶部。
mountPieceHeader();

// 标题栏（第一行）：左侧留给系统红绿灯、可拖拽，最右端助手 icon。
renderTitlebar(document.querySelector("#titlebar-root")!, {
  // 单击：开/关整个助手。
  onAssistantToggle: async () => {
    await toggleAssistantFromChrome();
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
const DEFAULT_FONT = 15;
let currentFontSize = 15;

function applyFontSize(size: number) {
  currentFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, size));
  document.documentElement.style.setProperty("--editor-font", `${currentFontSize}px`);
}

async function saveFontSize() {
  const config = await getConfig();
  await invoke("set_config", { newConfig: { ...config, font_size: currentFontSize } });
}

/** 字号快捷键入口：+1/-1 调整，0 复位默认。 */
function bumpFont(delta: number) {
  applyFontSize(delta === 0 ? DEFAULT_FONT : currentFontSize + delta);
  void saveFontSize();
}

async function init() {
  const config = await getConfig();
  applyFontSize(config.font_size);
  pieceOutlineDefault = config.piece_outline_default ?? false;
  applyPieceOutlineMode(pieceOutlineDefault);
  await bootstrapProjects(config);

  const assistant = await invoke<{ open: boolean }>("get_assistant_state");
  layoutController = createLayoutController(app, { assistantOpen: assistant.open });
  layoutController.apply();
  applyView();

  // ── 窗内快捷键 ──
  let uninstallShortcuts: (() => void) | null = null;

  async function loadShortcuts() {
    const ws = await invoke<Record<WindowShortcutId, string>>("get_window_shortcuts");
    const values: Record<WindowShortcutId, string> = { ...WINDOW_SHORTCUT_DEFAULTS, ...ws };
    const bindings = buildBindings(values);
    if (uninstallShortcuts) uninstallShortcuts();
    uninstallShortcuts = installShortcuts(actions, bindings);
  }

  const actions: ShortcutActions = {
    toggleAssistant: async () => {
      await toggleAssistantFromChrome();
    },
    toggleAssistantBubble: async () => {
      const cur = await invoke<{ open: boolean }>("get_assistant_state");
      if (!cur.open) {
        const next = await invoke<{ open: boolean }>("toggle_assistant");
        layoutController?.setAssistantOpen(next.open);
        tasksPanel.syncLayout();
        assistantHandle.setInputOpen(true);
      } else {
        assistantHandle.setInputOpen(!assistantHandle.isInputOpen());
      }
    },
    toggleActionPanel: () => tasksPanel.toggle(),
    quickAddAction: () => tasksPanel.quickAdd(),
    selectView: (v) => selectView(v),
    startNewConversation: async () => {
      const cur = await invoke<{ open: boolean }>("get_assistant_state");
      if (!cur.open) {
        const next = await invoke<{ open: boolean }>("toggle_assistant");
        layoutController?.setAssistantOpen(next.open);
        tasksPanel.syncLayout();
      }
      assistantHandle.startNewConversation();
    },
    isAssistantStreaming: () => assistantHandle.isStreaming(),
    cancelAssistant: () => assistantHandle.cancel(),
    isActionPanelOpen: () => tasksPanel.isOpen(),
    closeActionPanel: () => tasksPanel.setOpen(false),
    isAssistantBubbleOpen: () => assistantHandle.isInputOpen(),
    collapseAssistantBubble: () => assistantHandle.setInputOpen(false),
    isHistoryPopoverOpen: () => assistantHandle.isHistoryPopoverOpen(),
    closeHistoryPopover: () => assistantHandle.closeHistoryPopover(),
    isPermissionBubbleOpen: () => assistantHandle.isPermissionBubbleOpen(),
    closePermissionBubble: () => assistantHandle.closePermissionBubble(),
    isSkillMenuOpen: () => assistantHandle.isSkillMenuOpen(),
    closeSkillMenu: () => assistantHandle.closeSkillMenu(),
    isMentionMenuOpen: () => assistantHandle.isMentionMenuOpen(),
    closeMentionMenu: () => assistantHandle.closeMentionMenu(),
    canSplit: () => canSplit(window.innerWidth),
    bumpFont,
  };

  await loadShortcuts();
  await listen("window-shortcuts-changed", () => { void loadShortcuts(); });

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
  const target = resolveMergeTarget(doc, caret, source);
  if (target.kind === "merge") {
    const existing = doc.slice(target.range.from, target.range.to);
    const merged = mergeQuoteBlock(existing, body);
    editor.dispatch({
      changes: { from: target.range.from, to: target.range.to, insert: merged },
      selection: { anchor: target.range.from + merged.length },
      scrollIntoView: true,
    });
  } else {
    // `target.at` is the caret when no card is nearby, or the end of the nearest
    // card when the source differs — so different-source quotes stack as sibling
    // blocks after the card instead of merging or splitting it.
    const at = target.at;
    const before = doc.slice(0, at);
    const after = doc.slice(at);
    const insert = buildCaretInsert(before, after, buildQuoteBlock(body, source));
    insertAtPos(editor, at, insert);
  }
  editor.focus();
});

void listen("accessibility-needed", () => {
  // macOS 已由后端弹过一次系统授权框；这里只在窗内给一条简短提示，
  // 不再往 #note-body 正文区塞横幅（避免污染编辑器内容）。
  showToast("需开启「辅助功能」权限后重试");
});

let lastAutomationToastAt = 0;

void listen("automation-needed", () => {
  // 后端识别到当前前台是已知浏览器，但 osascript 读不到标签页 URL/标题
  // （macOS 自动化权限未授/被拒/超时）。提示用户去授权，授权后即可恢复
  // 网址+标题捕获；本条引用仍会以"仅 app 名"落地。
  const now = Date.now();
  if (now - lastAutomationToastAt < 30_000) return;
  lastAutomationToastAt = now;
  showToast("浏览器授权未完成，已先保存为应用来源；授权后重试即可");
});
