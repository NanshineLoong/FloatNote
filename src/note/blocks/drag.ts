import { EditorView } from "@codemirror/view";
import { blockRanges, moveBlockChanges, type BlockRange } from "./ranges";
import { buildCaretInsert } from "../append";
import { insertAtPos } from "../editor";

/**
 * Cross-pane block drag. The Inbox editor's block handle initiates a drag; while
 * the pointer stays inside `#text-col` it behaves as a reorder (existing
 * semantics), and once it crosses into `#piece-col` it switches to copy-into-
 * piece: the source block is inserted as its own paragraph at the nearest
 * paragraph boundary in the piece editor. Inbox is never modified — undo is a
 * single step (`⌘Z` in the piece editor).
 *
 * `dropIndex` / `placeIndicator` are view-agnostic and reused for both editors;
 * `pickMode` / `pieceDropPos` are pure so the routing math is unit-testable
 * without a real CodeMirror or DOM.
 */

export interface DragContext {
  /** Piece editor, looked up lazily at drag time (it's created after the inbox). */
  getPieceView: () => EditorView | null;
  isSplitActive: () => boolean;
  textColEl: HTMLElement;
  pieceColEl: HTMLElement;
}

const DRAG_THRESHOLD = 4;

/**
 * The drop indicator (`<div class="cm-block-drop">`) is appended to a view's
 * `scrollDOM` and positioned against it, so the scroller must be a positioning
 * context. The inbox editor gets this via `gutterTheme` in handle-gutter; the
 * piece editor has no gutter, so apply this theme to its extensions instead.
 */
export const scrollerPositionTheme = EditorView.theme({
  ".cm-scroller": { position: "relative" },
});

type Mode = "reorder" | "cross";

// ── pure helpers (unit-tested) ──────────────────────────────────────────────

function pointInRect(x: number, y: number, r: DOMRect): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/**
 * Decide which pane a drag is currently targeting. When split is off, or no
 * piece editor exists, the drag can only reorder inside the inbox. When the
 * pointer is in the gap between columns (or off both panes) we keep the last
 * mode so the indicator doesn't flicker as the user slides across the seam.
 */
export function pickMode(
  x: number,
  y: number,
  textColRect: DOMRect,
  pieceColRect: DOMRect,
  isSplit: boolean,
  hasPiece: boolean,
  lastMode: Mode,
): Mode {
  if (!isSplit || !hasPiece) return "reorder";
  if (pointInRect(x, y, pieceColRect)) return "cross";
  if (pointInRect(x, y, textColRect)) return "reorder";
  return lastMode;
}

/**
 * Char offset in the piece doc at which to insert the dropped block for a given
 * drop index (0..length, matching `dropIndex`). Inserting before block `to`, or
 * at end-of-doc when `to` is past the last block.
 */
export function pieceDropPos(pieceRanges: BlockRange[], toPiece: number, docLength: number): number {
  if (toPiece >= pieceRanges.length) return docLength;
  return pieceRanges[toPiece].from;
}

// ── view-aware helpers (moved here from handle-gutter) ──────────────────────

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
    y = view.coordsAtPos(ranges[ranges.length - 1]?.to ?? 0)?.bottom;
  } else {
    y = view.coordsAtPos(ranges[to].from)?.top;
  }
  if (y == null) return;
  const box = view.scrollDOM.getBoundingClientRect();
  el.style.top = `${y - box.top + view.scrollDOM.scrollTop}px`;
}

// ── lifecycle ───────────────────────────────────────────────────────────────

interface Session {
  abort: () => void;
}

let currentSession: Session | null = null;

/** Abort an in-flight drag without committing (e.g. the piece file changed on
 * disk mid-drag). Safe to call when no drag is active. */
export function cancelBlockDrag() {
  currentSession?.abort();
}

export function startBlockDrag(
  ctx: DragContext,
  sourceView: EditorView,
  blockFrom: number,
  event: PointerEvent,
  onTap?: (event: PointerEvent) => void,
) {
  if (currentSession) return; // single-instance guard
  event.preventDefault();

  const initial = blockRanges(sourceView.state.doc.toString());
  const fromIndex = initial.findIndex((r) => r.from === blockFrom);
  if (fromIndex < 0) return;

  const startX = event.clientX;
  const startY = event.clientY;
  let dragging = false;
  let aborted = false;
  let mode: Mode = "reorder";
  let reorderTo = fromIndex;
  let crossTo = 0;
  let inboxIndicator: HTMLElement | null = null;
  let pieceIndicator: HTMLElement | null = null;

  const pieceView0 = ctx.getPieceView();
  // Range sets are frozen at drag start — neither doc changes mid-drag (we only
  // commit on pointerup, and external edits abort via cancelBlockDrag).
  const pieceRanges = pieceView0 ? blockRanges(pieceView0.state.doc.toString()) : null;
  const blockText = sourceView.state.doc.sliceString(initial[fromIndex].from, initial[fromIndex].to);

  const ensureIndicator = (view: EditorView, which: "inbox" | "piece") => {
    if (which === "inbox") {
      if (!inboxIndicator) {
        inboxIndicator = document.createElement("div");
        inboxIndicator.className = "cm-block-drop";
        view.scrollDOM.appendChild(inboxIndicator);
      }
      return inboxIndicator;
    }
    if (!pieceIndicator) {
      pieceIndicator = document.createElement("div");
      pieceIndicator.className = "cm-block-drop";
      view.scrollDOM.appendChild(pieceIndicator);
    }
    return pieceIndicator;
  };

  const clearInbox = () => {
    inboxIndicator?.remove();
    inboxIndicator = null;
  };
  const clearPiece = () => {
    pieceIndicator?.remove();
    pieceIndicator = null;
  };

  const cleanup = () => {
    clearInbox();
    clearPiece();
    currentSession = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
  };

  const onMove = (e: PointerEvent) => {
    if (!dragging && Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return;
    if (!dragging) dragging = true;

    const pieceView = ctx.getPieceView();
    const textColRect = ctx.textColEl.getBoundingClientRect();
    const pieceColRect = ctx.pieceColEl.getBoundingClientRect();
    mode = pickMode(e.clientX, e.clientY, textColRect, pieceColRect, ctx.isSplitActive(), !!pieceView, mode);

    if (mode === "cross" && pieceView && pieceRanges) {
      clearInbox();
      crossTo = dropIndex(pieceView, pieceRanges, e.clientY);
      const el = ensureIndicator(pieceView, "piece");
      placeIndicator(pieceView, pieceRanges, crossTo, el);
    } else {
      clearPiece();
      const ranges = blockRanges(sourceView.state.doc.toString());
      reorderTo = dropIndex(sourceView, ranges, e.clientY);
      const el = ensureIndicator(sourceView, "inbox");
      placeIndicator(sourceView, ranges, reorderTo, el);
    }
  };

  const onUp = (e: PointerEvent) => {
    if (dragging && !aborted) {
      const pieceView = ctx.getPieceView();
      if (mode === "cross" && pieceView && pieceRanges) {
        const doc = pieceView.state.doc.toString();
        const pos = pieceDropPos(pieceRanges, crossTo, doc.length);
        const before = doc.slice(0, pos);
        const after = doc.slice(pos);
        const insert = buildCaretInsert(before, after, blockText);
        insertAtPos(pieceView, pos, insert);
        pieceView.focus();
      } else {
        const text = sourceView.state.doc.toString();
        const ranges = blockRanges(text);
        const changes = moveBlockChanges(text, ranges, fromIndex, reorderTo);
        if (changes.length) sourceView.dispatch({ changes });
      }
    } else if (!dragging) {
      // Single click (threshold never crossed) — defer to caller (opens block menu).
      onTap?.(e);
    }
    cleanup();
  };

  const onCancel = () => {
    aborted = true;
    cleanup();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);

  currentSession = { abort: () => { aborted = true; cleanup(); } };
}
