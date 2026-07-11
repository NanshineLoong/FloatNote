import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { stripTagMarker } from "@floatnote/note-logic";
import { outlineStateField } from "./outline-mode";
import { stripBidMarker } from "./quote";

/**
 * 列表折叠（编辑区常驻，非大纲模式）。
 *
 * 镜像 outline-mode.ts 的折叠机制，但作用于 Lezer 的 ListItem 子树：每个含嵌套子项
 * 的 ListItem 在其 marker 前放一个 hover 显现的三角按钮；折叠时把嵌套子树替换为
 * 一条 `▸ 文本 · N 项` 摘要（块替换、非可编辑，规避 CM6 嵌套 contenteditable 陷阱）。
 * 大纲模式开启时本扩展产出 Decoration.none，让位大纲自身的列表折叠。
 *
 * Lezer markdown 节点：ListItem 的嵌套子树即其 BulletList/OrderedList 子节点，
 * 该子节点的 [from,to] 覆盖整棵子树；ListItem.from == ListMark.from（marker 位置，
 * 不含行首缩进）。
 */

export interface ListFoldItem {
  /** 稳定键（含位置），用作 folded Set 的存储键。 */
  id: string;
  /** 内容+深度兜底标识，remap 时按位置失配后使用。 */
  fallbackId: string;
  /** ListItem.from == ListMark.from，三角 widget 锚点。 */
  from: number;
  /** 嵌套子树块替换起点（子列表首行的行首，吸收缩进）。 */
  childFrom: number;
  /** 嵌套子树块替换终点（吸收末尾换行，避免留空行）。 */
  childTo: number;
  hasChildren: boolean;
  /** 首行 marker 之后的正文（已 strip tag/bid），摘要展示用。 */
  text: string;
  /** ListItem 祖先数，顶层=0。 */
  depth: number;
}

export const ListFoldEffect = StateEffect.define<{ id: string; folded: boolean }>();

const LIST_CONTAINER = new Set(["BulletList", "OrderedList"]);

function listDepthOf(node: SyntaxNode): number {
  let depth = 0;
  let p = node.parent;
  while (p) {
    if (p.name === "ListItem") depth++;
    p = p.parent;
  }
  return depth;
}

function findChild(node: SyntaxNode, names: Set<string>): SyntaxNode | null {
  let c = node.firstChild;
  while (c) {
    if (names.has(c.name)) return c;
    c = c.nextSibling;
  }
  return null;
}

/** Walk the Lezer tree, collecting one ListFoldItem per ListItem. Exported for tests. */
export function parseListItems(state: EditorState): ListFoldItem[] {
  const doc = state.doc;
  const tree = ensureSyntaxTree(state, doc.length) ?? syntaxTree(state);
  const items: ListFoldItem[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== "ListItem") return;
      const sn = node.node;
      const depth = listDepthOf(sn);
      const listMark = findChild(sn, new Set(["ListMark"]));
      const nested = findChild(sn, LIST_CONTAINER);
      const firstLine = doc.lineAt(node.from);
      const markTo = listMark ? listMark.to : node.from;
      const text = stripBidMarker(stripTagMarker(doc.sliceString(markTo, firstLine.to).trim()));
      let childFrom = node.to;
      let childTo = node.to;
      if (nested) {
        childFrom = doc.lineAt(nested.from).from;
        childTo = nested.to;
        if (doc.sliceString(childTo, childTo + 1) === "\n") childTo += 1;
      }
      items.push({
        id: `list:${depth}:${node.from}:${text}`,
        fallbackId: `${depth}:${text}`,
        from: node.from,
        childFrom,
        childTo,
        hasChildren: !!nested,
        text,
        depth,
      });
    },
  });
  return items;
}

/** 把旧的 folded id 集映射到编辑后的新 id 集（镜像 outline-mode.remmapFolded）。
 *  先按 (depth, 映射后位置) 匹配，再按 fallbackId 兜底。 */
export function remapFolded(
  oldFolded: Set<string>,
  oldItems: ListFoldItem[],
  newItems: ListFoldItem[],
  mapPos: (pos: number) => number,
): Set<string> {
  const next = new Set<string>();
  const byFallback = new Map(newItems.map((i) => [i.fallbackId, i]));
  for (const id of oldFolded) {
    const old = oldItems.find((i) => i.id === id);
    if (!old) continue;
    const mappedFrom = mapPos(old.from);
    const byPos = newItems.find((i) => i.depth === old.depth && i.from === mappedFrom);
    const match = byPos ?? byFallback.get(old.fallbackId);
    if (match) next.add(match.id);
  }
  return next;
}

function buildDecorations(
  state: EditorState,
  items: ListFoldItem[],
  folded: Set<string>,
): DecorationSet {
  const entries: Array<{ from: number; to: number; deco: Decoration }> = [];
  const doc = state.doc;
  for (const it of items) {
    if (!it.hasChildren) continue;
    const descendantCount = items.filter((candidate) =>
      candidate.from >= it.childFrom && candidate.from < it.childTo && candidate.depth > it.depth).length;
    entries.push({
      from: it.from,
      to: it.from,
      deco: Decoration.widget({
        side: -1,
        widget: new ListFoldToggleWidget(it.id, folded.has(it.id), descendantCount),
      }),
    });
    if (folded.has(it.id)) {
      // 折叠：不显示摘要块，仅把子树各行收成零高度隐藏；折叠标识由父项
      // toggle 上的 ▸（常驻）承担。镜像 outline 的 .cm-outline-blank 做法。
      const startLine = state.doc.lineAt(it.childFrom).number;
      const endLine = state.doc.lineAt(Math.max(it.childFrom, it.childTo - 1)).number;
      for (let n = startLine; n <= endLine; n++) {
        const line = state.doc.line(n);
        entries.push({
          from: line.from,
          to: line.from,
          deco: Decoration.line({ class: "cm-list-fold-hidden" }),
        });
      }
    }
  }
  entries.sort((a, b) => (a.from !== b.from ? a.from - b.from : a.to - b.to));
  const builder = new RangeSetBuilder<Decoration>();
  for (const e of entries) {
    if (e.from < 0 || e.to > doc.length || e.from > e.to) continue;
    builder.add(e.from, e.to, e.deco);
  }
  return builder.finish();
}

interface ListFoldState {
  folded: Set<string>;
  items: ListFoldItem[];
  decorations: DecorationSet;
}

export const listFoldField = StateField.define<ListFoldState>({
  create(state) {
    const items = parseListItems(state);
    return {
      folded: new Set<string>(),
      items,
      decorations: buildDecorations(state, items, new Set()),
    };
  },

  update(value, tr) {
    let folded = new Set(value.folded);
    let mustRebuild = tr.docChanged;
    for (const e of tr.effects) {
      if (e.is(ListFoldEffect)) {
        if (e.value.folded) folded.add(e.value.id);
        else folded.delete(e.value.id);
        mustRebuild = true;
      }
    }
    const outlineBefore = !!tr.startState.field(outlineStateField, false)?.on;
    const outlineAfter = !!tr.state.field(outlineStateField, false)?.on;
    if (outlineBefore !== outlineAfter) mustRebuild = true;
    if (!mustRebuild) return value;

    const items = parseListItems(tr.state);
    if (tr.docChanged) {
      folded = remapFolded(folded, value.items, items, (p) => tr.changes.mapPos(p, 1));
    }
    const active = outlineAfter ? new Set<string>() : folded;
    return {
      folded,
      items,
      decorations: outlineAfter ? Decoration.none : buildDecorations(tr.state, items, active),
    };
  },

  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

/** bullet 旁 hover 显现的折叠三角。点击交给 listFoldPlugin 委托。 */
class ListFoldToggleWidget extends WidgetType {
  constructor(readonly id: string, readonly folded: boolean, readonly descendantCount: number) {
    super();
  }

  eq(o: ListFoldToggleWidget): boolean {
    return o.id === this.id && o.folded === this.folded && o.descendantCount === this.descendantCount;
  }

  toDOM(): HTMLElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cm-list-fold-toggle" + (this.folded ? " cm-list-fold-toggle-folded" : "");
    b.dataset.listFoldId = this.id;
    b.title = this.folded ? `展开 ${this.descendantCount} 个子项` : `折叠 ${this.descendantCount} 个子项`;
    b.setAttribute("aria-label", this.folded ? `展开 ${this.descendantCount} 个子项` : `折叠 ${this.descendantCount} 个子项`);
    b.setAttribute("aria-expanded", String(!this.folded));
    const ring = document.createElement("span");
    ring.className = "cm-list-fold-ring";
    ring.setAttribute("aria-hidden", "true");
    b.appendChild(ring);
    if (this.folded) {
      const count = document.createElement("span");
      count.className = "cm-list-fold-count";
      count.textContent = String(this.descendantCount);
      b.appendChild(count);
    }
    return b;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function toggleListFold(view: EditorView, id: string): void {
  const field = view.state.field(listFoldField);
  view.dispatch({ effects: ListFoldEffect.of({ id, folded: !field.folded.has(id) }) });
}

const listFoldPlugin = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}
    update() {}
  },
  {
    eventHandlers: {
      click(event: Event, view: EditorView): boolean {
        const target = event.target as HTMLElement | null;
        const btn = target?.closest<HTMLElement>(".cm-list-fold-toggle");
        if (!btn) return false;
        event.preventDefault();
        event.stopPropagation();
        toggleListFold(view, btn.dataset.listFoldId!);
        return true;
      },
      keydown(event: KeyboardEvent, view: EditorView): boolean {
        const target = event.target as HTMLElement | null;
        const btn = target?.closest<HTMLElement>(".cm-list-fold-toggle");
        if (!btn || (event.key !== "Enter" && event.key !== " ")) return false;
        event.preventDefault();
        toggleListFold(view, btn.dataset.listFoldId!);
        return true;
      },
    },
  },
);

export function listFold(): Extension[] {
  return [listFoldField, listFoldPlugin];
}
