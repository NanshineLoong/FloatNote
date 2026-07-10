import { indentMore, insertNewlineAndIndent } from "@codemirror/commands";
import {
  type EditorState,
  Facet,
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  buildDedentChange,
  buildEnterChange,
  buildIndentChange,
  buildMergeBackChange,
  buildMoveSubtreeChange,
  type OutlineEdit,
} from "./outline-edit";
import { lineStartsOf, parseOutline, type OutlineKind, type OutlineNode } from "./outline-tree";

type Command = (view: EditorView) => boolean;

export const OutlineToggleEffect = StateEffect.define<boolean>();
export const OutlineFoldEffect = StateEffect.define<{ id: string; folded: boolean }>();

const outlineInitialOn = Facet.define<boolean, boolean>({
  combine: (values) => values[values.length - 1] ?? false,
});

export interface OutlineModeState {
  on: boolean;
  folded: Set<string>;
  decorations: DecorationSet;
  nodes: OutlineNode[];
}

/**
 * 大纲 bullet：实心圆点（统一形态，叶子/可折叠同形）+ 仅可折叠节点带一个 hover 才显现的折叠三角。
 * 点本身不触发折叠；折叠由 .cm-outline-fold-toggle 按钮承担。
 */
class OutlineBulletWidget extends WidgetType {
  constructor(
    readonly node: OutlineNode,
    readonly folded: boolean,
    readonly hasChildren: boolean,
  ) {
    super();
  }

  eq(other: OutlineBulletWidget): boolean {
    return other.node.id === this.node.id &&
      other.folded === this.folded &&
      other.hasChildren === this.hasChildren;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "cm-outline-bullet";
    wrap.dataset.outlineDepth = String(this.node.depth);
    const dot = document.createElement("span");
    dot.className = "cm-outline-dot";
    wrap.appendChild(dot);
    if (this.hasChildren) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "cm-outline-fold-toggle";
      toggle.dataset.outlineId = this.node.id;
      toggle.title = this.folded ? "展开" : "折叠";
      toggle.setAttribute("aria-label", this.folded ? "展开子节点" : "折叠子节点");
      toggle.setAttribute("aria-expanded", String(!this.folded));
      toggle.textContent = this.folded ? "▸" : "▾";
      wrap.appendChild(toggle);
    }
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class FoldSummaryWidget extends WidgetType {
  constructor(readonly node: OutlineNode, readonly hiddenCount: number) {
    super();
  }

  eq(other: FoldSummaryWidget): boolean {
    return other.node.id === this.node.id && other.hiddenCount === this.hiddenCount;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-outline-fold-summary";
    wrap.style.setProperty("--outline-indent", `${Math.max(0, this.node.depth - 1) * 18}px`);
    wrap.textContent = `▸ ${this.node.text || "未命名"} · ${this.hiddenCount} 项`;
    return wrap;
  }
}

/**
 * 卡片 chip：内嵌实心点（与文本节点 bullet 一致）+ 标签。卡片是原子叶子，不可折叠，
 * 故不带 .cm-outline-fold-toggle。
 */
class CardWidget extends WidgetType {
  constructor(
    readonly kind: OutlineKind,
    readonly text: string,
    readonly id: string,
    readonly depth: number,
  ) {
    super();
  }

  eq(other: CardWidget): boolean {
    return other.kind === this.kind &&
      other.text === this.text &&
      other.id === this.id &&
      other.depth === this.depth;
  }

  toDOM(): HTMLElement {
    const chip = document.createElement("div");
    chip.className = `cm-outline-card-chip cm-outline-card-${this.kind}`;
    chip.dataset.outlineId = this.id;
    chip.style.setProperty("--outline-indent", `${Math.max(0, this.depth - 1) * 18}px`);
    chip.style.setProperty("--outline-depth", String(this.depth));
    const dot = document.createElement("span");
    dot.className = "cm-outline-dot";
    const label = document.createElement("span");
    label.className = "cm-outline-card-label";
    label.textContent = this.text;
    chip.appendChild(dot);
    chip.appendChild(label);
    return chip;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function isCard(kind: OutlineKind): boolean {
  return kind.endsWith("-card");
}

function hasChildren(node: OutlineNode): boolean {
  return node.childTo > node.childFrom;
}

function hiddenChildCount(nodes: OutlineNode[], node: OutlineNode): number {
  return nodes.filter((candidate) =>
    candidate.from >= node.childFrom &&
    candidate.to <= node.childTo &&
    candidate.depth > node.depth).length;
}

function buildDecorations(doc: string, nodes: OutlineNode[], folded: Set<string>): DecorationSet {
  if (nodes.length === 0) return Decoration.none;

  const lineStarts = lineStartsOf(doc);
  const lineRange = (n: number): { from: number; to: number } => {
    const from = lineStarts[n - 1];
    const to = n < lineStarts.length ? lineStarts[n] - 1 : doc.length;
    return { from, to };
  };

  // 块替换覆盖区间（卡片 + 折叠子树）：其内行不另发 line 装饰 / 不压空行。
  const covered: Array<{ from: number; to: number }> = [];
  const isCovered = (from: number, to: number) =>
    covered.some((c) => from >= c.from && to <= c.to);

  const entries: Array<{ from: number; to: number; decoration: Decoration }> = [];

  for (const node of nodes) {
    if (isCovered(node.from, node.to)) continue;
    const nodeHasChildren = hasChildren(node);

    if (isCard(node.kind)) {
      entries.push({
        from: node.from,
        to: node.to,
        decoration: Decoration.replace({
          block: true,
          widget: new CardWidget(node.kind, node.text, node.id, node.depth),
        }),
      });
      covered.push({ from: node.from, to: node.to });
    } else {
      // 整节点逐行 cm-outline-node：续行/软包行都拿到同一缩进 → 整节点（含 bullet）一起缩进
      const lineClass = [
        "cm-outline-node",
        `cm-outline-${node.kind}`,
        node.kind === "heading" ? "cm-outline-heading" : "",
      ].filter(Boolean).join(" ");
      const lineStyle = `--outline-indent:${Math.max(0, node.depth - 1) * 18}px;--outline-depth:${node.depth}`;
      for (let n = node.lineFrom; n <= node.lineTo; n++) {
        if (n < 1 || n > lineStarts.length) continue;
        const { from } = lineRange(n);
        if (isCovered(from, from)) continue;
        entries.push({
          from,
          to: from,
          decoration: Decoration.line({
            class: lineClass,
            attributes: { style: lineStyle },
          }),
        });
      }
      // bullet 仅在首行
      entries.push({
        from: node.from,
        to: node.from,
        decoration: Decoration.widget({
          side: -1,
          widget: new OutlineBulletWidget(node, folded.has(node.id), nodeHasChildren),
        }),
      });
    }

    if (folded.has(node.id) && nodeHasChildren) {
      entries.push({
        from: node.childFrom,
        to: node.childTo,
        decoration: Decoration.replace({
          block: true,
          widget: new FoldSummaryWidget(node, hiddenChildCount(nodes, node)),
        }),
      });
      covered.push({ from: node.childFrom, to: node.childTo });
    }
  }

  // 空行压制：不删行，仅压高度
  for (let n = 1; n <= lineStarts.length; n++) {
    const { from, to } = lineRange(n);
    if (isCovered(from, to)) continue;
    if (doc.slice(from, to).trim() !== "") continue;
    entries.push({
      from,
      to: from,
      decoration: Decoration.line({ class: "cm-outline-blank" }),
    });
  }

  return Decoration.set(
    entries
      .filter((entry) => entry.from >= 0 && entry.to <= doc.length && entry.from <= entry.to)
      .map((entry) => entry.decoration.range(entry.from, entry.to)),
    true,
  );
}

function createState(doc: string, on: boolean, folded: Set<string>): OutlineModeState {
  const nodes = parseOutline(doc);
  const activeFolded = on ? folded : new Set<string>();
  return {
    on,
    folded: activeFolded,
    nodes,
    decorations: on ? buildDecorations(doc, nodes, activeFolded) : Decoration.none,
  };
}

function remapFolded(
  oldFolded: Set<string>,
  oldNodes: OutlineNode[],
  nextNodes: OutlineNode[],
  mapPos: (pos: number) => number,
): Set<string> {
  const next = new Set<string>();
  const byFallback = new Map(nextNodes.map((node) => [node.fallbackId, node]));
  for (const id of oldFolded) {
    const old = oldNodes.find((node) => node.id === id);
    if (!old) continue;
    const mappedFrom = mapPos(old.from);
    const byMappedPos = nextNodes.find((node) =>
      node.kind === old.kind && node.depth === old.depth && node.from === mappedFrom);
    const match = byMappedPos ?? byFallback.get(old.fallbackId);
    if (match) next.add(match.id);
  }
  return next;
}

export const outlineStateField = StateField.define<OutlineModeState>({
  create(state) {
    return createState(state.doc.toString(), state.facet(outlineInitialOn), new Set());
  },

  update(value, tr) {
    let on = value.on;
    let folded = new Set(value.folded);
    let mustRebuild = tr.docChanged;

    for (const effect of tr.effects) {
      if (effect.is(OutlineToggleEffect)) {
        on = effect.value;
        folded = new Set();
        mustRebuild = true;
      } else if (effect.is(OutlineFoldEffect)) {
        if (effect.value.folded) folded.add(effect.value.id);
        else folded.delete(effect.value.id);
        mustRebuild = true;
      }
    }

    if (!mustRebuild) return value;
    const doc = tr.state.doc.toString();
    const nodes = parseOutline(doc);
    if (tr.docChanged && on) {
      folded = remapFolded(folded, value.nodes, nodes, (pos) => tr.changes.mapPos(pos, 1));
    }
    if (!on) folded = new Set();
    return {
      on,
      folded,
      nodes,
      decorations: on ? buildDecorations(doc, nodes, folded) : Decoration.none,
    };
  },
});

export function getOutlineState(state: EditorState): OutlineModeState {
  return state.field(outlineStateField);
}

/**
 * 统一调度：outline 关 → 透传默认；构造器返回 null → 透传默认；
 * swallow → 吞键不改文档；否则应用 changes + selection。
 */
function dispatchEdit(
  view: EditorView,
  build: () => OutlineEdit | null,
): boolean {
  const outline = view.state.field(outlineStateField, false);
  if (!outline?.on) return false;
  const edit = build();
  if (!edit) return false;
  if (edit.swallow) return true;
  view.dispatch({ changes: edit.changes, selection: edit.selection, scrollIntoView: true });
  return true;
}

const outlineEnter: Command = (view) =>
  dispatchEdit(view, () => buildEnterChange(view.state.doc.toString(), view.state.selection.main.from)) ||
  insertNewlineAndIndent(view);

const outlineTab: Command = (view) =>
  dispatchEdit(view, () => buildIndentChange(view.state.doc.toString(), view.state.selection.main.from)) ||
  indentMore(view);

const outlineShiftTab: Command = (view) =>
  dispatchEdit(view, () => buildDedentChange(view.state.doc.toString(), view.state.selection.main.from));

const outlineBackspace: Command = (view) =>
  dispatchEdit(view, () => buildMergeBackChange(view.state.doc.toString(), view.state.selection.main.from));

const outlineMoveUp: Command = (view) =>
  dispatchEdit(view, () => buildMoveSubtreeChange(view.state.doc.toString(), view.state.selection.main.from, "up"));

const outlineMoveDown: Command = (view) =>
  dispatchEdit(view, () => buildMoveSubtreeChange(view.state.doc.toString(), view.state.selection.main.from, "down"));

function toggleFold(view: EditorView, id: string): void {
  const outline = view.state.field(outlineStateField);
  view.dispatch({ effects: OutlineFoldEffect.of({ id, folded: !outline.folded.has(id) }) });
}

const outlinePlugin = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) {
    this.syncClass();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet ||
        update.transactions.some((tr) => tr.effects.length > 0)) {
      this.syncClass();
    }
  }

  syncClass(): void {
    const outline = this.view.state.field(outlineStateField, false);
    this.view.dom.classList.toggle("cm-outline-mode", !!outline?.on);
  }
}, {
  eventHandlers: {
    click(event, view) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLElement>(".cm-outline-fold-toggle");
      if (!button) return false;
      event.preventDefault();
      event.stopPropagation();
      toggleFold(view, button.dataset.outlineId!);
      return true;
    },
    keydown(event, view) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLElement>(".cm-outline-fold-toggle");
      if (!button || (event.key !== "Enter" && event.key !== " ")) return false;
      event.preventDefault();
      toggleFold(view, button.dataset.outlineId!);
      return true;
    },
  },
});

export function outlineMode(options: { initialOn?: boolean } = {}): Extension[] {
  return [
    outlineInitialOn.of(options.initialOn ?? false),
    outlineStateField,
    EditorView.decorations.from(outlineStateField, (value) => value.decorations),
    Prec.highest(keymap.of([
      { key: "Enter", run: outlineEnter },
      { key: "Tab", run: outlineTab },
      { key: "Shift-Tab", run: outlineShiftTab },
      { key: "Backspace", run: outlineBackspace },
      { key: "Mod-ArrowUp", run: outlineMoveUp },
      { key: "Mod-ArrowDown", run: outlineMoveDown },
    ])),
    outlinePlugin,
  ];
}
