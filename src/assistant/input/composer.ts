/**
 * Composer：把 CM6 编辑器 + 引用 chip + 统一候选 popover + 大输入 overlay + 键盘/IME
 * + 提交编排成一个可挂载的组件。assistant.ts 把原 `<textarea>` 换成它。
 *
 * 单一 EditorState 真源：普通态与大输入 overlay 共用同一个 EditorView（overlay 只是
 * 给宿主加 CSS 类），文本/光标/选区/引用/撤销重做/IME 全部原位保留。
 *
 * 键盘与 IME：用 domEventHandlers 的 keydown 拿到原始 event，Enter 仅在非组合输入
 * 且 popover 未开时提交；popover 打开时 ArrowUp/Down/Enter/Tab/Esc 交给 popover。
 */
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  keymap,
  drawSelection,
  placeholder,
  type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { refExtension, insertRefTransaction } from "./cm-extension";
import { detectTrigger } from "./trigger";
import { filterItems, type Candidate } from "./filter";
import { RefPopover } from "./popover";
import { mountInputOverlay } from "./overlay";
import { composePromptPayload, type PromptPayload } from "./submit";
import { clipboardPayload, docFromClipboard, REF_CLIPBOARD_MIME } from "./model";
import type { ChatScope } from "../../platform/chat-history";
import type { MentionFile } from "../mention-picker";
import type { SkillSummary } from "../skill-picker";

export interface ComposerOptions {
  /** EditorView 挂载点（取代原 textarea）。 */
  editorHost: HTMLElement;
  /** .assistant-input-wrap：overlay 加类用。 */
  wrapHost: HTMLElement;
  placeholder: string;
  getScope: () => ChatScope | null;
  listFiles: (scope: ChatScope) => Promise<MentionFile[]>;
  listSkills: () => Promise<SkillSummary[]>;
  /** 提交时调用，收到结构化 payload。 */
  onSubmit: (payload: PromptPayload) => void;
  /** 输入为空触发 send（Enter/点发送）时回调（assistant 切历史浮层）。 */
  onEmptySend?: () => void;
  /** 文档变更时通知宿主更新发送按钮等派生 UI。 */
  onChange?: () => void;
}

export interface ComposerHandle {
  destroy: () => void;
  focus: () => void;
  clear: () => void;
  isEmpty: () => boolean;
  getDoc: () => string;
  /** 在指定位置插入文本（缺省=光标处），用于程序化输入与测试。 */
  insertText: (text: string, at?: number) => void;
  /** 设置光标位置（单点选区）。 */
  select: (head: number) => void;
  /** 在编辑器 contentDOM 上派发 keydown，供测试与快捷键模拟。 */
  pressKey: (key: string, opts?: KeyboardEventInit) => void;
  /** 派发 compositionstart/end（IME 状态翻转），供测试。 */
  pressComposition: (phase: "start" | "end") => void;
  /** 测试缝：直接翻转内部 isComposing 标志（jsdom 合成 composition 事件不可靠）。 */
  __setComposing: (flag: boolean) => void;
  isPopoverOpen: () => boolean;
  closePopover: () => void;
  isLarge: () => boolean;
  collapseLarge: () => void;
  expandLarge: () => void;
  setScope: (scope: ChatScope | null) => void;
  submit: () => void;
  /** 右键小人入口：在光标处打开 skill 候选（无过滤词）。 */
  openSkillPicker: () => void;
}

const INPUT_CLASS = "fn-assistant-input";

export function mountComposer(opts: ComposerOptions): ComposerHandle {
  let currentScope: ChatScope | null = opts.getScope();
  let fileCache: { scope: ChatScope; files: MentionFile[] } | null = null;
  let skillCache: SkillSummary[] | null = null;
  let recomputeToken = 0;
  let isComposing = false;

  const view = new EditorView({
    state: EditorState.create({
      doc: "",
      extensions: [
        history(),
        EditorView.lineWrapping,
        drawSelection(),
        placeholder(opts.placeholder),
        refExtension(),
        keymap.of([
          {
            key: "Enter",
            run: (v) => onEnter(v),
            // Shift-Enter 不绑定 → 落到默认换行
          },
          { key: "ArrowUp", run: () => onArrow(-1) },
          { key: "ArrowDown", run: () => onArrow(1) },
          { key: "Tab", run: () => onConfirm() },
          { key: "Escape", run: () => onEscape() },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.domEventHandlers({
          compositionstart: () => {
            isComposing = true;
          },
          compositionend: () => {
            isComposing = false;
            scheduleRecompute();
          },
          copy: (event, v) => {
            const { from, to } = v.state.selection.main;
            if (from === to || !event.clipboardData) return false;
            const payload = clipboardPayload(v.state.doc.sliceString(from, to));
            event.preventDefault();
            event.clipboardData.setData("text/plain", payload.plainText);
            event.clipboardData.setData(REF_CLIPBOARD_MIME, JSON.stringify(payload.structured));
            return true;
          },
          cut: (event, v) => {
            const { from, to } = v.state.selection.main;
            if (from === to || !event.clipboardData) return false;
            const payload = clipboardPayload(v.state.doc.sliceString(from, to));
            event.preventDefault();
            event.clipboardData.setData("text/plain", payload.plainText);
            event.clipboardData.setData(REF_CLIPBOARD_MIME, JSON.stringify(payload.structured));
            v.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: "delete.cut" });
            return true;
          },
          paste: (event, v) => {
            if (!event.clipboardData) return false;
            const text = docFromClipboard(
              event.clipboardData.getData("text/plain"),
              event.clipboardData.getData(REF_CLIPBOARD_MIME),
            );
            if (!text) return false;
            const { from, to } = v.state.selection.main;
            event.preventDefault();
            v.dispatch({
              changes: { from, to, insert: text },
              selection: { anchor: from + text.length },
              userEvent: "input.paste",
            });
            return true;
          },
        }),
        EditorView.updateListener.of((u: ViewUpdate) => {
          if (u.docChanged || u.selectionSet) scheduleRecompute();
          if (u.docChanged) repositionPopover(u.view);
          if (u.docChanged) opts.onChange?.();
        }),
      ],
    }),
    parent: opts.editorHost,
  });
  view.scrollDOM.classList.add(INPUT_CLASS);
  view.dom.classList.add(INPUT_CLASS);

  const overlay = mountInputOverlay({
    host: opts.wrapHost,
    getView: () => view,
    onCollapse: () => view.focus(),
  });

  const popover = new RefPopover({
    editorView: () => view,
    onSelect: (ref, trigger) => {
      view.dispatch(insertRefTransaction(ref, trigger.from, trigger.to));
      view.focus();
    },
    onClose: () => {
      /* 状态由 scheduleRecompute 维护，无需额外清理 */
    },
  });

  // ── 候选数据源 ─────────────────────────────────────────────────────
  function fileCandidates(files: MentionFile[]): Candidate[] {
    return files.map((f) => ({
      ref: { kind: "file", id: f.name, display: f.name, meta: { noteKind: f.kind } },
    }));
  }
  function skillCandidates(skills: SkillSummary[]): Candidate[] {
    return skills.map((s) => ({
      ref: { kind: "skill", id: s.name, display: s.name },
      description: s.description,
    }));
  }

  async function ensureFiles(): Promise<MentionFile[] | null> {
    const scope = currentScope;
    if (!scope) return null;
    if (fileCache && sameScope(fileCache.scope, scope)) return fileCache.files;
    try {
      const files = await opts.listFiles(scope);
      fileCache = { scope, files };
      return files;
    } catch {
      fileCache = null;
      return null;
    }
  }
  async function ensureSkills(): Promise<SkillSummary[]> {
    if (skillCache) return skillCache;
    try {
      skillCache = await opts.listSkills();
    } catch {
      skillCache = [];
    }
    return skillCache;
  }

  // ── 触发检测 + 候选展示 ──────────────────────────────────────────────
  function scheduleRecompute(): void {
    const doc = view.state.doc.toString();
    const head = view.state.selection.main.head;
    const trigger = detectTrigger(doc, head);
    if (!trigger) {
      popover.close();
      return;
    }
    const token = ++recomputeToken;
    if (trigger.mode === "file") {
      void ensureFiles().then((files) => {
        if (token !== recomputeToken || !files) return;
        showFiltered(fileCandidates(files), trigger);
      });
    } else {
      void ensureSkills().then((skills) => {
        if (token !== recomputeToken) return;
        showFiltered(skillCandidates(skills), trigger);
      });
    }
  }

  function showFiltered(candidates: Candidate[], trigger: ReturnType<typeof detectTrigger>): void {
    if (!trigger) return;
    // 异步拉取期间 trigger 可能已变，重读
    const doc = view.state.doc.toString();
    const head = view.state.selection.main.head;
    const latest = detectTrigger(doc, head);
    if (!latest || latest.mode !== trigger.mode) {
      popover.close();
      return;
    }
    const scored = filterItems(candidates, latest.query);
    popover.show(scored, { from: latest.from, to: latest.to });
  }

  function repositionPopover(v: EditorView): void {
    if (popover.isOpen()) popover.reposition();
    void v;
  }

  // ── 键盘（keymap 绑定，进 CM6 输入层）───────────────────────────────
  function onEnter(v: EditorView): boolean {
    // 返回 true 让 CM6 停止继续匹配 defaultKeymap 的 Enter（否则会插入换行并把
    // 触发器移出光标）。真实 IME 的文本确认由 composition/input 事件写回文档。
    if (isComposing || v.composing) return true;
    if (popover.isOpen()) {
      popover.confirm();
      return true;
    }
    submit();
    return true;
  }
  function onArrow(delta: number): boolean {
    if (!popover.isOpen()) return false;
    popover.move(delta);
    return true;
  }
  function onConfirm(): boolean {
    if (!popover.isOpen()) return false;
    popover.confirm();
    return true;
  }
  function onEscape(): boolean {
    if (popover.isOpen()) {
      popover.close();
      return true;
    }
    if (overlay.isLarge()) {
      overlay.collapse();
      return true;
    }
    return false;
  }

  // ── 提交 ─────────────────────────────────────────────────────────────
  function submit(): void {
    const doc = view.state.doc.toString();
    const payload = composePromptPayload(doc);
    const empty = !payload.userText.trim() && payload.references.length === 0 && !payload.skill;
    if (empty) {
      opts.onEmptySend?.();
      return;
    }
    opts.onSubmit(payload);
    clear();
  }

  function clear(): void {
    const len = view.state.doc.length;
    if (len > 0) {
      view.dispatch({ changes: { from: 0, to: len }, selection: { anchor: 0 } });
    }
    popover.close();
  }

  function setScope(scope: ChatScope | null): void {
    currentScope = scope;
    fileCache = null; // 切换作用域失效文件缓存
  }

  function openSkillPicker(): void {
    // 在光标处插入一个 `/` 触发 skill 候选（与右键小人入口统一）
    const head = view.state.selection.main.head;
    const doc = view.state.doc.toString();
    // 仅在行首/空白后插入 / 才触发；若光标前非空白则先插空格
    const before = doc.slice(0, head);
    const needSpace = before.length > 0 && !/\s$/.test(before);
    const insert = (needSpace ? " " : "") + "/";
    view.dispatch({
      changes: { from: head, to: head, insert },
      selection: { anchor: head + insert.length },
    });
    view.focus();
    scheduleRecompute();
  }

  return {
    destroy() {
      popover.destroy();
      overlay.destroy();
      view.destroy();
    },
    focus() {
      view.focus();
    },
    clear,
    isEmpty() {
      return view.state.doc.length === 0;
    },
    getDoc() {
      return view.state.doc.toString();
    },
    insertText(text: string, at?: number) {
      const pos = at ?? view.state.selection.main.head;
      view.dispatch({
        changes: { from: pos, to: pos, insert: text },
        selection: { anchor: pos + text.length },
      });
    },
    select(head: number) {
      view.dispatch({ selection: { anchor: head } });
    },
    pressKey(key: string, opts?: KeyboardEventInit) {
      view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...opts }));
    },
    pressComposition(phase: "start" | "end") {
      const type = phase === "start" ? "compositionstart" : "compositionend";
      view.contentDOM.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
    },
    __setComposing(flag: boolean) {
      isComposing = flag;
    },
    isPopoverOpen() {
      return popover.isOpen();
    },
    closePopover() {
      popover.close();
    },
    isLarge() {
      return overlay.isLarge();
    },
    collapseLarge() {
      overlay.collapse();
    },
    expandLarge() {
      overlay.expand();
    },
    setScope,
    submit,
    openSkillPicker,
  };
}

function sameScope(a: ChatScope, b: ChatScope): boolean {
  return a.scopeType === b.scopeType && a.scopePath === b.scopePath;
}
