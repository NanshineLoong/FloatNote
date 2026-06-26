/**
 * 分屏几何（纯逻辑）：宽窗 + 开分屏时把内容区切成 [pad][Inbox][gap][成品][pad]。
 * 两栏等宽，夹在 [paneMin, paneMax]；超出 paneMax 的富余溢进左右边距（窗口超宽时居中）。
 * 窄到放不下两栏（< canSplit）时由调用方回退单栏。助手此时一律 floating，不参与本几何。
 */
export interface SplitPrefs {
  pad: number;
  gap: number;
  paneMin: number;
  paneMax: number;
}

export interface SplitLayout {
  leftMargin: number;
  inboxWidth: number;
  gap: number;
  pieceWidth: number;
  rightMargin: number;
}

export const SPLIT_PREFS: SplitPrefs = {
  pad: 28,
  gap: 24,
  paneMin: 360,
  paneMax: 560,
};

export function canSplit(width: number, prefs: SplitPrefs = SPLIT_PREFS): boolean {
  return width >= 2 * prefs.pad + 2 * prefs.paneMin + prefs.gap;
}

export function computeSplitLayout(width: number, prefs: SplitPrefs = SPLIT_PREFS): SplitLayout {
  const inner = width - 2 * prefs.pad - prefs.gap;
  const pane = Math.max(prefs.paneMin, Math.min(prefs.paneMax, inner / 2));
  const margin = (width - 2 * pane - prefs.gap) / 2;
  return {
    leftMargin: margin,
    inboxWidth: pane,
    gap: prefs.gap,
    pieceWidth: pane,
    rightMargin: margin,
  };
}
