/** 8-directional, ratio-locked image resize math.
 *
 *  An image stores only `width` (`{width=N}`); height follows the natural
 *  aspect ratio. Dragging any of the 8 edge/corner handles produces a new
 *  width plus an optional translate so the opposite edge stays fixed during
 *  the drag (committed width alone determines the final layout on release).
 *
 *  `x`/`y` are the sign of that direction's contribution to width; `anchorX`/
 *  `anchorY` mean "translate the wrap on this axis to keep the opposite edge
 *  fixed". For corner handles (both x and y nonzero) the larger-magnitude
 *  contribution wins so a diagonal drag doesn't undersize.
 */
export type Dir = -1 | 0 | 1;

export interface HandleSpec {
  id: "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
  x: Dir;
  y: Dir;
  cursor: string;
  anchorX: boolean;
  anchorY: boolean;
}

export const HANDLE_SPECS: HandleSpec[] = [
  { id: "n", x: 0, y: -1, cursor: "ns-resize", anchorX: false, anchorY: true },
  { id: "ne", x: 1, y: -1, cursor: "nesw-resize", anchorX: false, anchorY: true },
  { id: "e", x: 1, y: 0, cursor: "ew-resize", anchorX: false, anchorY: false },
  { id: "se", x: 1, y: 1, cursor: "nwse-resize", anchorX: false, anchorY: false },
  { id: "s", x: 0, y: 1, cursor: "ns-resize", anchorX: false, anchorY: false },
  { id: "sw", x: -1, y: 1, cursor: "nesw-resize", anchorX: true, anchorY: false },
  { id: "w", x: -1, y: 0, cursor: "ew-resize", anchorX: true, anchorY: false },
  { id: "nw", x: -1, y: -1, cursor: "nwse-resize", anchorX: true, anchorY: true },
];

export interface ResizeInput {
  startW: number;
  dx: number;
  dy: number;
  ratio: number;
  maxW: number;
}

export interface ResizeResult {
  width: number;
  tx: number;
  ty: number;
}

export const MIN_WIDTH = 40;

/** Compute the next width + wrap translate for a handle drag. Pure, DOM-free. */
export function computeResize(spec: HandleSpec, r: ResizeInput): ResizeResult {
  const hContrib = spec.x !== 0 ? spec.x * r.dx : 0;
  const vContrib = spec.y !== 0 ? spec.y * r.dy * r.ratio : 0;
  let delta: number;
  if (spec.x !== 0 && spec.y !== 0) {
    delta = Math.abs(hContrib) >= Math.abs(vContrib) ? hContrib : vContrib;
  } else {
    delta = hContrib + vContrib;
  }
  const width = Math.max(MIN_WIDTH, Math.min(r.startW + delta, r.maxW));
  const dw = width - r.startW;
  const tx = spec.anchorX ? -dw : 0;
  const ty = spec.anchorY ? -dw / r.ratio : 0;
  return { width, tx, ty };
}
