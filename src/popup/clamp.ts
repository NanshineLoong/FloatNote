export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Clamp the popup's top-left (x, y) so a w×h popup stays within `bounds`.
 * Bounds are logical screen coordinates (minX/minY may be negative on
 * multi-monitor layouts with displays to the left/above the primary).
 */
export function clampToScreen(
  x: number,
  y: number,
  w: number,
  h: number,
  bounds: Rect,
): { x: number; y: number } {
  const minX = bounds.minX;
  const maxX = bounds.maxX - w;
  const minY = bounds.minY;
  const maxY = bounds.maxY - h;

  const cx = Math.min(Math.max(x, minX), Math.max(minX, maxX));
  const cy = Math.min(Math.max(y, minY), Math.max(minY, maxY));
  return { x: cx, y: cy };
}

export function placePopup(
  anchorX: number,
  anchorY: number,
  width: number,
  height: number,
  bounds: Rect,
  options: {
    anchorOffsetX?: number;
    gap?: number;
    surfaceInset?: number;
  } = {},
): { x: number; y: number } {
  const { anchorOffsetX = -10, gap = 5, surfaceInset = 0 } = options;
  const x = anchorX - anchorOffsetX;
  const below = anchorY + gap - surfaceInset;
  const above = anchorY - height - gap + surfaceInset;
  const y = below + height <= bounds.maxY ? below : above;
  return clampToScreen(x, y, width, height, bounds);
}
