/**
 * Tag color palette + tint derivation. Block backgrounds use a translucent
 * tint of the tag's hex color so text stays readable.
 *
 * The canonical `PALETTE` (and `freeColors`) lives in `@floatnote/note-logic`
 * so the sidecar agent's tag tools see the exact same color set the user sees
 * in this picker. Only the DOM-facing `tint`/`hexToRgb` helpers live here.
 */

export { PALETTE, type Swatch } from "@floatnote/note-logic";

/** Parse a `#rgb` / `#rrggbb` / `#rrggbbaa` hex color into r,g,b (0–255). */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Translucent background tint (~12% alpha) for a hex color. */
export function tint(hex: string, alpha = 0.12): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
