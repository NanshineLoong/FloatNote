import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { type BlockInfo, EditorView, gutter, GutterMarker } from "@codemirror/view";
import { blockRanges, removeBlockChanges, type BlockRange } from "@floatnote/note-logic";
import { startBlockDrag, type DragContext } from "./drag";
import { createIcon } from "../../shared/ui/icon";

/**
 * A block action is one entry in the handle's click menu. The list is the
 * extension point the design calls for: adding "标签" or "加入清单" later is a
 * single entry here, no other code changes. v1 ships only delete.
 */
interface BlockAction {
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
    deleteBlock(view, range);
  },
};

const ACTIONS: BlockAction[] = [deleteAction];

export type BlockMenuOpener = (
  view: EditorView,
  range: BlockRange,
  index: number,
  x: number,
  y: number,
) => void;

export function deleteBlock(view: EditorView, range: BlockRange): void {
  const ranges = blockRanges(view.state.doc.toString());
  const index = ranges.findIndex((r) => r.from === range.from);
  if (index < 0) return;
  const changes = removeBlockChanges(ranges, index);
  if (changes.length) view.dispatch({ changes });
}

class HandleMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const el = document.createElement("div");
    el.className = "cm-block-handle";
    el.append(createIcon({ phosphor: "ph ph-dots-six-vertical", size: 16 }));
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
    item.append(createIcon({ phosphor: `ph ${action.icon}`, size: 13 }), document.createTextNode(action.label));
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

const gutterTheme = EditorView.theme({
  // The drop indicator is positioned against the scroller, so anchor it there.
  ".cm-scroller": { position: "relative" },
});

/**
 * Per-block left handle: a Notion-style grip in a CodeMirror gutter. Drag to
 * reorder the block's text (precise transaction); drag across into the piece
 * column to copy the block into the piece editor; single-click to open the
 * action menu. Only attach this to the Inbox editor — pieces don't get handles.
 *
 * `ctx` lets the drag orchestrator (drag.ts) find the piece editor and split
 * state lazily, since the piece editor is created after the inbox.
 *
 * `customOpenMenu` lets the inbox replace the generic action menu with its
 * contextual tag menu while this module stays tag-agnostic.
 */
export function blockHandleGutter(
  ctx: DragContext,
  customOpenMenu?: BlockMenuOpener,
): Extension {
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
          const onTap = (e: PointerEvent) => {
            const ranges = blockRanges(view.state.doc.toString());
            const idx = ranges.findIndex((r) => r.from === line.from);
            if (idx < 0) return;
            if (customOpenMenu) {
              customOpenMenu(view, ranges[idx], idx, e.clientX, e.clientY);
            } else {
              openMenu(view, ranges[idx], idx, e.clientX, e.clientY);
            }
          };
          startBlockDrag(ctx, view, line.from, event, onTap);
          return true;
        },
      },
    }),
    gutterTheme,
  ];
}
