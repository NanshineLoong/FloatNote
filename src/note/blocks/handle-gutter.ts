import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { type BlockInfo, EditorView, gutter, GutterMarker } from "@codemirror/view";
import {
  blockRanges,
  moveBlockChanges,
  removeBlockChanges,
  type BlockRange,
} from "./ranges";

/**
 * A block action is one entry in the handle's click menu. The list is the
 * extension point the design calls for: adding "标签" or "加入清单" later is a
 * single entry here, no other code changes. v1 ships only delete.
 */
export interface BlockAction {
  id: string;
  label: string;
  /** Phosphor icon class, e.g. "ph-trash". */
  icon: string;
  run: (view: EditorView, range: BlockRange, index: number) => void;
}

const deleteAction: BlockAction = {
  id: "delete",
  label: "删除",
  icon: "ph-trash",
  run: (view, range) => {
    const ranges = blockRanges(view.state.doc.toString());
    const index = ranges.findIndex((r) => r.from === range.from);
    if (index < 0) return;
    const changes = removeBlockChanges(ranges, index);
    if (changes.length) view.dispatch({ changes });
  },
};

const ACTIONS: BlockAction[] = [deleteAction];

const DRAG_THRESHOLD = 4;

class HandleMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-block-handle";
    el.innerHTML = `<i class="ph ph-dots-six-vertical"></i>`;
    return el;
  }
}

const handleMarker = new HandleMarker();

function buildMarkers(view: EditorView) {
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const r of blockRanges(view.state.doc.toString())) {
    builder.add(r.from, r.from, handleMarker);
  }
  return builder.finish();
}

// ── click menu ─────────────────────────────────────────────────────────────
let menuEl: HTMLElement | null = null;

function closeMenu() {
  menuEl?.remove();
  menuEl = null;
}

function openMenu(view: EditorView, range: BlockRange, index: number, x: number, y: number) {
  closeMenu();
  const menu = document.createElement("div");
  menu.className = "switch-menu block-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  for (const action of ACTIONS) {
    const item = document.createElement("button");
    item.className = "switch-item";
    item.innerHTML = `<i class="ph ${action.icon}"></i> ${action.label}`;
    item.onclick = () => {
      closeMenu();
      action.run(view, range, index);
    };
    menu.appendChild(item);
  }

  menuEl = menu;
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener("pointerdown", closeMenu, { once: true }), 0);
}

// ── drag reorder ───────────────────────────────────────────────────────────
/** How many blocks have their vertical midpoint above the pointer = drop slot. */
function dropIndex(view: EditorView, ranges: BlockRange[], clientY: number): number {
  let count = 0;
  for (const r of ranges) {
    const top = view.coordsAtPos(r.from)?.top;
    const bottom = view.coordsAtPos(r.to)?.bottom;
    if (top == null || bottom == null) continue;
    if ((top + bottom) / 2 < clientY) count++;
  }
  return count;
}

function placeIndicator(view: EditorView, ranges: BlockRange[], to: number, el: HTMLElement) {
  let y: number | undefined;
  if (to >= ranges.length) {
    y = view.coordsAtPos(ranges[ranges.length - 1].to)?.bottom;
  } else {
    y = view.coordsAtPos(ranges[to].from)?.top;
  }
  if (y == null) return;
  const box = view.scrollDOM.getBoundingClientRect();
  el.style.top = `${y - box.top + view.scrollDOM.scrollTop}px`;
}

function startInteraction(view: EditorView, blockFrom: number, event: PointerEvent) {
  event.preventDefault();
  closeMenu();

  const initial = blockRanges(view.state.doc.toString());
  const fromIndex = initial.findIndex((r) => r.from === blockFrom);
  if (fromIndex < 0) return;

  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  let to = fromIndex;
  let indicator: HTMLElement | null = null;

  const onMove = (e: PointerEvent) => {
    if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      indicator = document.createElement("div");
      indicator.className = "cm-block-drop";
      view.scrollDOM.appendChild(indicator);
    }
    const ranges = blockRanges(view.state.doc.toString());
    to = dropIndex(view, ranges, e.clientY);
    placeIndicator(view, ranges, to, indicator!);
  };

  const onUp = (e: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    indicator?.remove();

    if (dragging) {
      const text = view.state.doc.toString();
      const ranges = blockRanges(text);
      const changes = moveBlockChanges(text, ranges, fromIndex, to);
      if (changes.length) view.dispatch({ changes });
    } else {
      openMenu(view, initial[fromIndex], fromIndex, e.clientX, e.clientY);
    }
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

const gutterTheme = EditorView.theme({
  // The drop indicator is positioned against the scroller, so anchor it there.
  ".cm-scroller": { position: "relative" },
});

/**
 * Per-block left handle: a Notion-style grip in a CodeMirror gutter. Drag to
 * reorder the block's text (precise transaction), single-click to open the
 * action menu. Only attach this to the Inbox editor — pieces don't get handles.
 */
export function blockHandleGutter(): Extension {
  return [
    gutter({
      class: "cm-block-gutter",
      markers: (view) => buildMarkers(view),
      initialSpacer: () => handleMarker,
      domEventHandlers: {
        pointerdown(view: EditorView, line: BlockInfo, event: Event) {
          if (!(event instanceof PointerEvent)) return false;
          const target = event.target as HTMLElement | null;
          if (!target?.closest(".cm-block-handle")) return false;
          startInteraction(view, line.from, event);
          return true;
        },
      },
    }),
    gutterTheme,
  ];
}
