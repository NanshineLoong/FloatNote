import { updateConfig } from "./notes-state";

const FONT_MIN = 10;
const FONT_MAX = 28;
const DEFAULT_FONT = 15;
let currentFontSize = 15;

export function applyFontSize(size: number) {
  currentFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, size));
  document.documentElement.style.setProperty("--editor-font", `${currentFontSize}px`);
}

async function saveFontSize() {
  await updateConfig({ font_size: currentFontSize });
}

/** 字号快捷键入口：+1/-1 调整，0 复位默认。 */
export function bumpFont(delta: number) {
  applyFontSize(delta === 0 ? DEFAULT_FONT : currentFontSize + delta);
  void saveFontSize();
}
