/**
 * Curated tag color palette + tint derivation. Block backgrounds use a
 * translucent tint of the tag's hex color so text stays readable.
 */

export interface Swatch {
  id: string;
  color: string;
}

/** Eight curated swatches spanning the common hues. */
export const PALETTE: Swatch[] = [
  { id: "red", color: "#e5484d" },
  { id: "orange", color: "#f5a623" },
  { id: "amber", color: "#f2c744" },
  { id: "green", color: "#3cb371" },
  { id: "teal", color: "#0d9488" },
  { id: "blue", color: "#3b82f6" },
  { id: "violet", color: "#8b5cf6" },
  { id: "pink", color: "#ec4899" },
];

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
