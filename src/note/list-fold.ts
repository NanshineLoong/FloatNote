import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  Facet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Text,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { stripBidMarker } from "./quote";

/**
 * 列表折叠（编辑区常驻）。
 *
 * 作用于 Lezer 的 ListItem 子树：每个含嵌套子项
 * 的 ListItem 在其 marker 前放一个 hover 显现的三角按钮；折叠时把嵌套子树替换为
 * 一条 `▸ 文本 · N 项` 摘要（块替换、非可编辑，规避 CM6 嵌套 contenteditable 陷阱）。
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
  /** 嵌套子树块替换终点（不跨入下一同级项的行首）。 */
  childTo: number;
  hasChildren: boolean;
  /** 首行 marker 之后的正文（已 strip tag/bid），摘要展示用。 */
  text: string;
  /** ListItem 祖先数，顶层=0。 */
  depth: number;
  /** ListItem subtree 中的后代项数量。 */
  descendantCount: number;
}

export const ListFoldEffect = StateEffect.define<{ id: string; folded: boolean }>();
export const listFoldEnabled = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

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

function listFoldItem(doc: Text, node: SyntaxNode): ListFoldItem {
  const depth = listDepthOf(node);
  const listMark = findChild(node, new Set(["ListMark"]));
  const nested = findChild(node, LIST_CONTAINER);
  const firstLine = doc.lineAt(node.from);
  const markTo = listMark ? listMark.to : node.from;
  const text = stripBidMarker(doc.sliceString(markTo, firstLine.to).trim());
  return {
    id: `list:${depth}:${node.from}:${text}`,
    fallbackId: `${depth}:${text}`,
    from: node.from,
    childFrom: nested ? doc.lineAt(nested.from).from : node.to,
    childTo: nested?.to ?? node.to,
    hasChildren: !!nested,
    text,
    depth,
    descendantCount: 0,
  };
}

/** Fold target carried by preview marker widgets, avoiding a post-render DOM scan. */
export function listFoldTargetForMarker(doc: Text, listMark: SyntaxNode): string | null {
  const item = listMark.parent;
  if (item?.name !== "ListItem") return null;
  const info = listFoldItem(doc, item);
  return info.hasChildren ? info.id : null;
}

/** Walk the Lezer tree, collecting one ListFoldItem per ListItem. Exported for tests. */
export function parseListItems(state: EditorState): ListFoldItem[] {
  const doc = state.doc;
  const tree = ensureSyntaxTree(state, doc.length) ?? syntaxTree(state);
  const items: ListFoldItem[] = [];
  const openItems: number[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== "ListItem") return;
      openItems.push(items.length);
      items.push(listFoldItem(doc, node.node));
    },
    leave(node) {
      if (node.name !== "ListItem") return;
      const index = openItems.pop();
      if (index !== undefined) items[index].descendantCount = items.length - index - 1;
    },
  });
  return items;
}

/** 把旧的 folded id 集映射到编辑后的新 id 集。
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
    entries.push({
      from: it.from,
      to: it.from,
      deco: Decoration.widget({
        side: -1,
        widget: new ListFoldToggleWidget(it.id, folded.has(it.id), it.descendantCount),
      }),
    });
    // A line class cannot override CodeMirror's measured minimum line height,
    // so it only made descendants visually compressed, not actually folded.
    // Replace the whole child range at a line boundary instead. Nested folded
    // entries are subsumed by their nearest folded ancestor to avoid overlapping
    // replacement decorations.
    if (folded.has(it.id) && !items.some((parent) =>
      parent.id !== it.id && folded.has(parent.id) &&
      it.childFrom >= parent.childFrom && it.childTo <= parent.childTo)) {
      entries.push({
        from: it.childFrom,
        to: it.childTo,
        deco: Decoration.replace({ block: true }),
      });
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
    if (!mustRebuild) return value;

    const items = parseListItems(tr.state);
    if (tr.docChanged) {
      folded = remapFolded(folded, value.items, items, (p) => tr.changes.mapPos(p, 1));
    }
    return {
      folded,
      items,
      decorations: buildDecorations(tr.state, items, folded),
    };
  },

  provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
});

/** 返回能触发折叠的列表父项 id；叶子标记仍保留普通编辑行为。 */
export function listFoldTargetId(
  view: Pick<EditorView, "state" | "posAtDOM">,
  target: Element | null,
): string | null {
  const toggle = target?.closest<HTMLElement>(".cm-list-fold-toggle");
  if (toggle?.dataset.listFoldId) return toggle.dataset.listFoldId;

  const marker = target?.closest<HTMLElement>(".cm-list-leaf-dot, .cm-preview-ol-mark");
  if (!marker) return null;
  if (marker.dataset?.listFoldId) return marker.dataset.listFoldId;
  const position = view.posAtDOM(marker, 0);
  const items = view.state.field(listFoldField, false)?.items ?? parseListItems(view.state);
  const line = view.state.doc.lineAt(position);
  const item = items.find((candidate) =>
    candidate.hasChildren && candidate.from >= line.from && candidate.from <= line.to);
  return item?.id ?? null;
}

export function isListFolded(state: EditorState, id: string): boolean {
  return state.field(listFoldField, false)?.folded.has(id) ?? false;
}

/** bullet 旁的折叠箭头。 */
class ListFoldToggleWidget extends WidgetType {
  constructor(readonly id: string, readonly folded: boolean, readonly descendantCount: number) {
    super();
  }

  eq(o: ListFoldToggleWidget): boolean {
    return o.id === this.id && o.folded === this.folded && o.descendantCount === this.descendantCount;
  }

  toDOM(view: EditorView): HTMLElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cm-list-fold-toggle" + (this.folded ? " cm-list-fold-toggle-folded" : "");
    b.dataset.listFoldId = this.id;
    b.title = this.folded ? `展开 ${this.descendantCount} 个子项` : `折叠 ${this.descendantCount} 个子项`;
    b.setAttribute("aria-label", this.folded ? `展开 ${this.descendantCount} 个子项` : `折叠 ${this.descendantCount} 个子项`);
    b.setAttribute("aria-expanded", String(!this.folded));
    const chevron = document.createElement("span");
    chevron.className = "cm-list-fold-chevron";
    chevron.setAttribute("aria-hidden", "true");
    chevron.textContent = "›";
    b.appendChild(chevron);
    return b;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function toggleListFold(view: EditorView, id: string): void {
  const field = view.state.field(listFoldField);
  view.dispatch({ effects: ListFoldEffect.of({ id, folded: !field.folded.has(id) }) });
}

const listFoldPlugin = ViewPlugin.fromClass(
  class {
    private readonly onMouseDown = (event: MouseEvent) => {
      const id = listFoldTargetId(this.view, event.target instanceof Element ? event.target : null);
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
    };

    private readonly onClick = (event: MouseEvent) => {
      const id = listFoldTargetId(this.view, event.target instanceof Element ? event.target : null);
      if (!id) return;
      event.preventDefault();
      event.stopPropagation();
      toggleListFold(this.view, id);
    };

    constructor(readonly view: EditorView) {
      // List markers are replacement widgets, whose events CodeMirror does not
      // delegate to ViewPlugin.eventHandlers. Capture on the editor root so a
      // marker click is stopped before the editor can move its selection.
      view.dom.addEventListener("mousedown", this.onMouseDown, true);
      view.dom.addEventListener("click", this.onClick, true);
    }

    update(update: ViewUpdate) {
      for (const transaction of update.transactions) {
        for (const effect of transaction.effects) {
          if (!effect.is(ListFoldEffect)) continue;
          for (const marker of this.view.dom.querySelectorAll<HTMLElement>(
            ".cm-list-fold-marker[data-list-fold-id]",
          )) {
            if (marker.dataset.listFoldId === effect.value.id) {
              marker.classList.toggle("cm-list-fold-marker-folded", effect.value.folded);
            }
          }
        }
      }
    }

    destroy(): void {
      this.view.dom.removeEventListener("mousedown", this.onMouseDown, true);
      this.view.dom.removeEventListener("click", this.onClick, true);
    }
  },
);

export function listFold(): Extension[] {
  return [listFoldEnabled.of(true), listFoldField, listFoldPlugin];
}
